// Bahan olahan (stock_semi_items): CRUD, stock count and "Catat Masak".
const createHttpError = require("http-errors");
const { emitRealtimeEvent } = require("../../infrastructure/realtime/socket");
const asyncHandler = require("../../shared/http/asyncHandler");
const { roundRecipeQuantity } = require("../menu/menu.options");
const { toTitleName } = require("../../shared/utils/names");
const { dateKey, todayKey } = require("../../shared/utils/validate");
const SemiItem = require("./semi.repository");
const { readWasteInput } = require("./wastes");

const toNonNegativeNumber = (value) => Math.max(Number(value) || 0, 0);

const emitStockChanged = (action, semiItemId) =>
  emitRealtimeEvent("stock:changed", { action, semiItemId });

// Raw stock items with quantities in their own unit; repeated items are summed.
const sumByStockItem = (lines) => {
  const quantityByStockItemId = new Map();

  for (const line of Array.isArray(lines) ? lines : []) {
    const stockItemId = Number(line?.stockItemId) || 0;
    if (stockItemId <= 0) continue;
    quantityByStockItemId.set(
      stockItemId,
      roundRecipeQuantity((quantityByStockItemId.get(stockItemId) || 0) + toNonNegativeNumber(line?.quantity))
    );
  }

  return [...quantityByStockItemId].map(([stockItemId, quantity]) => ({ stockItemId, quantity }));
};

// The semi item's bahan baku with their takaran standar (0: keep the one it
// has), and defaultPortions the portions they make (left out: keep it,
// empty: none). unit and portionSize left out keep the item's own.
const normalizeSemiPayload = (body) => ({
  name: toTitleName(body.name),
  category: String(body.category || "").trim() || "Olahan",
  unit: String(body.unit || "").trim() || null,
  portionSize: body.portionSize === undefined ? null : roundRecipeQuantity(toNonNegativeNumber(body.portionSize)),
  defaultPortions:
    body.defaultPortions === undefined
      ? undefined
      : Math.round(toNonNegativeNumber(body.defaultPortions) * 100) / 100 || null,
  minimumStock: toNonNegativeNumber(body.minimumStock),
  // Leftover written off at the daily recap (Nasi); off for items that keep.
  resetDaily: body.resetDaily === undefined ? true : Boolean(body.resetDaily),
  components: sumByStockItem(body.components),
});

const validateSemiPayload = async ({ name, components }) => {
  if (!name) return createHttpError(400, "Nama bahan olahan wajib diisi.");
  if (!components.length) {
    return createHttpError(400, "Pilih minimal satu bahan baku.");
  }

  const ids = components.map((component) => component.stockItemId);
  const activeIds = await SemiItem.findActiveRawIds(ids);
  if (activeIds.length !== ids.length) {
    return createHttpError(400, "Ada bahan baku yang tidak ditemukan. Muat ulang daftar bahan.");
  }

  if (await SemiItem.isRawItemName(name)) {
    return createHttpError(409, `${name} sudah dipakai di bahan baku. Pilih nama lain.`);
  }

  return null;
};

const getSemiItems = asyncHandler(async (_req, res) => {
  res.status(200).json({ success: true, data: await SemiItem.findAll() });
});

const saveSemiItem = (isUpdate) =>
  asyncHandler(async (req, res, next) => {
    const id = isUpdate ? Number(req.params.id) : null;
    const payload = normalizeSemiPayload(req.body);
    const validationError = await validateSemiPayload(payload);

    if (validationError) return next(validationError);

    let savedId;
    try {
      savedId = await SemiItem.save(id, payload);
    } catch (error) {
      if (error.code === "ER_DUP_ENTRY") {
        return next(createHttpError(409, "Nama bahan sudah dipakai. Pilih nama lain."));
      }
      throw error;
    }

    if (!savedId) return next(createHttpError(404, "Bahan olahan tidak ditemukan."));

    emitStockChanged(isUpdate ? "semi-item-updated" : "semi-item-created", savedId);
    res.status(isUpdate ? 200 : 201).json({
      success: true,
      message: isUpdate ? "Bahan olahan diperbarui." : "Bahan olahan ditambahkan.",
      data: await SemiItem.findById(savedId),
    });
  });

const addSemiItem = saveSemiItem(false);
const updateSemiItem = saveSemiItem(true);

const deleteSemiItem = asyncHandler(async (req, res, next) => {
  const id = Number(req.params.id);
  const recipeMenuNames = await SemiItem.findRecipeMenuNames(id);

  if (recipeMenuNames.length) {
    return next(
      createHttpError(
        409,
        `Bahan masih dipakai di resep menu: ${recipeMenuNames.join(", ")}. Hapus dari resep terlebih dahulu.`
      )
    );
  }

  if (!(await SemiItem.remove(id))) {
    return next(createHttpError(404, "Bahan olahan tidak ditemukan."));
  }

  emitStockChanged("semi-item-deleted", id);
  res.status(200).json({ success: true, message: "Bahan olahan dihapus." });
});

// "Catat Masak": the bahan baku used (items, each in its own stock unit) and
// the result, weighed (outputWeight, in the portion size's unit) or counted
// (portionQuantity). portionSize, when given, becomes the Takaran 1 Porsi.
const recordProduction = asyncHandler(async (req, res, next) => {
  const items = sumByStockItem(req.body.items).filter((used) => used.quantity > 0);
  const outputWeight = roundRecipeQuantity(toNonNegativeNumber(req.body.outputWeight));
  const portionQuantity = toNonNegativeNumber(req.body.portionQuantity);
  const portionSize = roundRecipeQuantity(toNonNegativeNumber(req.body.portionSize));
  const note = String(req.body.note || "").trim().slice(0, 255);
  // Daily Prep of another business day (a shift recorded after midnight);
  // today when not given.
  const producedDate = req.body.producedDate ? dateKey(req.body.producedDate, "Tanggal masak") : null;

  if (!items.length) {
    return next(createHttpError(400, "Isi jumlah bahan baku yang dipakai."));
  }
  if (producedDate && producedDate > todayKey()) {
    return next(createHttpError(400, "Tanggal masak tidak boleh setelah hari ini."));
  }
  if (outputWeight <= 0 && portionQuantity <= 0) {
    return next(createHttpError(400, "Isi berat hasil masak atau jumlah porsinya."));
  }

  const semiId = Number(req.params.id);
  const productionId = await SemiItem.recordProduction(
    semiId,
    {
      items,
      outputWeight,
      portionQuantity,
      portionSize,
      note,
      producedDate: producedDate === todayKey() ? null : producedDate,
    },
    req.user?.id || req.user?._id
  );
  if (!productionId) return next(createHttpError(404, "Bahan olahan tidak ditemukan."));

  emitStockChanged("semi-item-produced", semiId);
  res.status(201).json({
    success: true,
    message: "Catatan masak disimpan.",
    data: await SemiItem.findById(semiId),
  });
});

// "Simpan Takaran Standar" at Catat Masak: the quantities and portions typed
// become the next cooking's starting values and the HPP standar, without
// cooking.
const saveStandard = asyncHandler(async (req, res, next) => {
  const items = sumByStockItem(req.body.items).filter((used) => used.quantity > 0);
  const portionQuantity = toNonNegativeNumber(req.body.portionQuantity);
  if (!items.length) return next(createHttpError(400, "Isi jumlah bahan baku yang dipakai."));
  if (portionQuantity <= 0) return next(createHttpError(400, "Isi jumlah porsi jadi."));

  const semiId = Number(req.params.id);
  if (!(await SemiItem.saveStandard(semiId, { items, portionQuantity }))) {
    return next(createHttpError(404, "Bahan olahan tidak ditemukan."));
  }

  const item = await SemiItem.findById(semiId);
  // With no portions in stock the HPP standar is its COGS now.
  const cogs =
    Number(item.stock) <= 0
      ? ` COGS jadi Rp ${new Intl.NumberFormat("id-ID").format(item.averageCost)} / ${item.unit}.`
      : " COGS tetap dari porsi yang sudah dimasak sampai stoknya habis.";
  emitStockChanged("semi-item-standard", semiId);
  res.status(200).json({ success: true, message: `Takaran standar ${item.name} disimpan.${cogs}`, data: item });
});

// Pengganti: bahan olahan a menu may be sold with instead of this one
// ([{ semiItemId, extraPrice }]); every menu using it offers them at the kasir.
const saveSubstitutes = asyncHandler(async (req, res, next) => {
  const substitutes = [];
  for (const line of Array.isArray(req.body.substitutes) ? req.body.substitutes : []) {
    const semiItemId = Number(line?.semiItemId) || 0;
    if (semiItemId <= 0 || substitutes.some((substitute) => substitute.semiItemId === semiItemId)) continue;
    substitutes.push({ semiItemId, extraPrice: Math.round(toNonNegativeNumber(line?.extraPrice)) });
  }

  const semiId = Number(req.params.id);
  if (!(await SemiItem.saveSubstitutes(semiId, substitutes))) {
    return next(createHttpError(404, "Bahan olahan tidak ditemukan."));
  }

  emitStockChanged("semi-item-substitutes", semiId);
  // The kasir's menus offer the new choices.
  emitRealtimeEvent("menu:changed", { action: "ingredient-choices-changed", semiItemId: semiId });
  res.status(200).json({
    success: true,
    message: "Pengganti disimpan.",
    data: await SemiItem.findById(semiId),
  });
});

const getProductions = asyncHandler(async (req, res) => {
  res.status(200).json({
    success: true,
    data: await SemiItem.listProductions(Number(req.params.id)),
  });
});

const deleteProduction = asyncHandler(async (req, res, next) => {
  const semiId = await SemiItem.deleteProduction(Number(req.params.productionId));
  if (semiId === null) return next(createHttpError(404, "Catatan masak tidak ditemukan."));

  emitStockChanged("semi-item-production-deleted", semiId);
  res.status(200).json({ success: true, message: "Catatan masak dibatalkan." });
});

// Portions thrown away during the day (Buang), with their bukti foto.
const recordWaste = asyncHandler(async (req, res, next) => {
  const semiId = Number(req.params.id);
  const recorded = await SemiItem.recordWaste(semiId, readWasteInput(req), req.user?.id || req.user?._id);
  if (!recorded) return next(createHttpError(404, "Bahan olahan tidak ditemukan."));

  emitStockChanged("semi-item-wasted", semiId);
  res.status(201).json({
    success: true,
    message: "Kerugian dicatat.",
    data: await SemiItem.findById(semiId),
  });
});

const isDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));

const getWastes = asyncHandler(async (req, res, next) => {
  const { from, to } = req.query;
  if ((from && !isDate(from)) || (to && !isDate(to))) {
    return next(createHttpError(400, "Tanggal harus berformat YYYY-MM-DD."));
  }

  res.status(200).json({
    success: true,
    data: await SemiItem.listWastes({
      from: from || null,
      to: to || null,
      semiItemId: Number(req.query.semiItemId) || null,
    }),
  });
});

const deleteWaste = asyncHandler(async (req, res, next) => {
  const semiId = await SemiItem.deleteWaste(Number(req.params.wasteId));
  if (semiId === null) return next(createHttpError(404, "Catatan buang tidak ditemukan."));

  emitStockChanged("semi-item-waste-deleted", semiId);
  res.status(200).json({ success: true, message: "Catatan buang dibatalkan." });
});

module.exports = {
  addSemiItem,
  deleteProduction,
  deleteSemiItem,
  deleteWaste,
  getProductions,
  getSemiItems,
  getWastes,
  recordProduction,
  saveStandard,
  saveSubstitutes,
  recordWaste,
  updateSemiItem,
};
