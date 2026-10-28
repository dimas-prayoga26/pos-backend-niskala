// Bahan setengah jadi (stock_semi_items): CRUD, stock count and "Catat Masak".
const createHttpError = require("http-errors");
const { emitRealtimeEvent } = require("../../infrastructure/realtime/socket");
const asyncHandler = require("../../shared/http/asyncHandler");
const { roundRecipeQuantity } = require("../menu/menu.options");
const SemiItem = require("./semi.repository");

const toNonNegativeNumber = (value) => Math.max(Number(value) || 0, 0);

const emitStockChanged = (action, semiItemId) =>
  emitRealtimeEvent("stock:changed", { action, semiItemId });

// One recipe of the semi item: raw stock items with quantities in their own
// unit. Repeated items are summed.
const normalizeSemiPayload = (body) => {
  const quantityByStockItemId = new Map();

  for (const component of Array.isArray(body.components) ? body.components : []) {
    const stockItemId = Number(component?.stockItemId) || 0;
    const quantity = roundRecipeQuantity(component?.quantity);
    if (stockItemId > 0 && quantity > 0) {
      quantityByStockItemId.set(
        stockItemId,
        roundRecipeQuantity((quantityByStockItemId.get(stockItemId) || 0) + quantity)
      );
    }
  }

  return {
    name: String(body.name || "").trim(),
    category: String(body.category || "").trim() || "Olahan",
    unit: String(body.unit || "").trim() || "porsi",
    portionSize: roundRecipeQuantity(toNonNegativeNumber(body.portionSize)),
    minimumStock: toNonNegativeNumber(body.minimumStock),
    // Leftover written off at the daily recap (Nasi); off for items that keep.
    resetDaily: body.resetDaily === undefined ? true : Boolean(body.resetDaily),
    components: [...quantityByStockItemId].map(([stockItemId, quantity]) => ({
      stockItemId,
      quantity,
    })),
  };
};

const validateSemiPayload = async ({ name, components }) => {
  if (!name) return createHttpError(400, "Nama bahan setengah jadi wajib diisi.");
  if (!components.length) {
    return createHttpError(400, "Isi minimal satu bahan baku beserta takarannya.");
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

    if (!savedId) return next(createHttpError(404, "Bahan setengah jadi tidak ditemukan."));

    emitStockChanged(isUpdate ? "semi-item-updated" : "semi-item-created", savedId);
    res.status(isUpdate ? 200 : 201).json({
      success: true,
      message: isUpdate ? "Bahan setengah jadi diperbarui." : "Bahan setengah jadi ditambahkan.",
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
    return next(createHttpError(404, "Bahan setengah jadi tidak ditemukan."));
  }

  emitStockChanged("semi-item-deleted", id);
  res.status(200).json({ success: true, message: "Bahan setengah jadi dihapus." });
});

const updateSemiStock = asyncHandler(async (req, res, next) => {
  const semiItem = await SemiItem.updateStock(
    Number(req.params.id),
    toNonNegativeNumber(req.body.stock),
    req.user?.id || req.user?._id
  );

  if (!semiItem) return next(createHttpError(404, "Bahan setengah jadi tidak ditemukan."));

  emitStockChanged("semi-stock-updated", semiItem.id);
  res.status(200).json({ success: true, message: "Stok diperbarui.", data: semiItem });
});

// "Catat Masak": batchQuantity recipes cooked; the result is weighed
// (outputWeight, in the portion size's unit) or counted (portionQuantity).
const recordProduction = asyncHandler(async (req, res, next) => {
  const batchQuantity = roundRecipeQuantity(req.body.batchQuantity);
  const outputWeight = roundRecipeQuantity(toNonNegativeNumber(req.body.outputWeight));
  const portionQuantity = toNonNegativeNumber(req.body.portionQuantity);
  const note = String(req.body.note || "").trim().slice(0, 255);

  if (batchQuantity <= 0) {
    return next(createHttpError(400, "Jumlah resep yang dimasak harus lebih dari 0."));
  }
  if (outputWeight <= 0 && portionQuantity <= 0) {
    return next(createHttpError(400, "Isi berat hasil masak atau jumlah porsinya."));
  }

  const semiId = Number(req.params.id);
  const productionId = await SemiItem.recordProduction(
    semiId,
    { batchQuantity, outputWeight, portionQuantity, note },
    req.user?.id || req.user?._id
  );
  if (!productionId) return next(createHttpError(404, "Bahan setengah jadi tidak ditemukan."));

  emitStockChanged("semi-item-produced", semiId);
  res.status(201).json({
    success: true,
    message: "Catatan masak disimpan.",
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

// Reasons a cashier picks for portions thrown away during the day. The
// system adds "Sisa akhir hari" (daily recap) and "Penyesuaian" (stock count).
const WASTE_REASONS = ["Basi", "Tumpah", "Lainnya"];

const recordWaste = asyncHandler(async (req, res, next) => {
  const quantity = Math.round(toNonNegativeNumber(req.body.quantity) * 100) / 100;
  const reason = String(req.body.reason || "").trim();
  const note = String(req.body.note || "").trim().slice(0, 255);

  if (quantity <= 0) {
    return next(createHttpError(400, "Jumlah porsi yang dibuang harus lebih dari 0."));
  }
  if (!WASTE_REASONS.includes(reason)) {
    return next(createHttpError(400, `Alasan harus salah satu dari: ${WASTE_REASONS.join(", ")}.`));
  }

  const semiId = Number(req.params.id);
  const recorded = await SemiItem.recordWaste(
    semiId,
    { quantity, reason, note },
    req.user?.id || req.user?._id
  );
  if (!recorded) return next(createHttpError(404, "Bahan setengah jadi tidak ditemukan."));

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
  recordWaste,
  updateSemiItem,
  updateSemiStock,
};
