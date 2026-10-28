const createHttpError = require("http-errors");
const { emitRealtimeEvent } = require("../../infrastructure/realtime/socket");
const asyncHandler = require("../../shared/http/asyncHandler");
const { roundRecipeQuantity } = require("../menu/menu.options");
const Prepared = require("./prepared.repository");
const StockItem = require("./stock.repository");

const toNonNegativeNumber = (value) => Math.max(Number(value) || 0, 0);

const emitStockChanged = (action, stockItemId) =>
  emitRealtimeEvent("stock:changed", { action, stockItemId });

// One recipe of the prepared item: raw stock items with quantities in their
// own unit. Repeated items are summed.
const normalizePreparedPayload = (body) => {
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
    components: [...quantityByStockItemId].map(([stockItemId, quantity]) => ({
      stockItemId,
      quantity,
    })),
  };
};

const validatePreparedPayload = async ({ name, components }, id) => {
  if (!name) return createHttpError(400, "Nama bahan olahan wajib diisi.");
  if (!components.length) {
    return createHttpError(400, "Isi minimal satu bahan beserta takarannya.");
  }

  const ids = components.map((component) => component.stockItemId);
  if (id && ids.includes(id)) {
    return createHttpError(400, "Bahan olahan tidak bisa memakai dirinya sendiri.");
  }

  const kinds = await Prepared.findKinds(ids);
  if (kinds.length !== ids.length) {
    return createHttpError(400, "Ada bahan yang tidak ditemukan. Muat ulang daftar bahan.");
  }

  const preparedNames = kinds.filter((kind) => kind.isPrepared).map((kind) => kind.name);
  if (preparedNames.length) {
    return createHttpError(
      400,
      `${preparedNames.join(", ")} juga bahan olahan. Komposisi hanya boleh dari bahan mentah.`
    );
  }

  return null;
};

const savePreparedItem = (isUpdate) =>
  asyncHandler(async (req, res, next) => {
    const id = isUpdate ? Number(req.params.id) : null;
    const payload = normalizePreparedPayload(req.body);
    const validationError = await validatePreparedPayload(payload, id);

    if (validationError) return next(validationError);

    let savedId;
    try {
      savedId = await Prepared.savePrepared(id, payload);
    } catch (error) {
      if (error.code === "ER_DUP_ENTRY") {
        return next(createHttpError(409, "Nama bahan sudah dipakai. Pilih nama lain."));
      }
      throw error;
    }

    if (!savedId) return next(createHttpError(404, "Bahan olahan tidak ditemukan."));

    emitStockChanged(isUpdate ? "prepared-item-updated" : "prepared-item-created", savedId);
    res.status(isUpdate ? 200 : 201).json({
      success: true,
      message: isUpdate ? "Bahan olahan diperbarui." : "Bahan olahan ditambahkan.",
      data: await StockItem.findById(savedId),
    });
  });

const addPreparedItem = savePreparedItem(false);
const updatePreparedItem = savePreparedItem(true);

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

  const productionId = await Prepared.recordProduction(
    Number(req.params.id),
    { batchQuantity, outputWeight, portionQuantity, note },
    req.user?.id || req.user?._id
  );
  if (!productionId) return next(createHttpError(404, "Bahan olahan tidak ditemukan."));

  emitStockChanged("prepared-item-produced", Number(req.params.id));
  res.status(201).json({
    success: true,
    message: "Catatan masak disimpan.",
    data: await StockItem.findById(req.params.id),
  });
});

const getProductions = asyncHandler(async (req, res) => {
  res.status(200).json({
    success: true,
    data: await Prepared.listProductions(Number(req.params.id)),
  });
});

const deleteProduction = asyncHandler(async (req, res, next) => {
  const preparedId = await Prepared.deleteProduction(Number(req.params.productionId));
  if (preparedId === null) return next(createHttpError(404, "Catatan masak tidak ditemukan."));

  emitStockChanged("prepared-item-production-deleted", preparedId);
  res.status(200).json({ success: true, message: "Catatan masak dibatalkan." });
});

module.exports = {
  addPreparedItem,
  deleteProduction,
  getProductions,
  recordProduction,
  updatePreparedItem,
};
