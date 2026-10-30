// Barang "Lainnya" (stock_supply_items: peralatan, perlengkapan, promosi,
// lain-lain): /api/stock-item/supply.
const createHttpError = require("http-errors");
const { emitRealtimeEvent } = require("../../infrastructure/realtime/socket");
const asyncHandler = require("../../shared/http/asyncHandler");
const { isDuplicateEntryError } = require("../../shared/utils/dbErrors");
const { isSemiItemName } = require("./stock.repository");
const SupplyItem = require("./supply.repository");

const toNonNegativeNumber = (value) => Math.max(Number(value) || 0, 0);

const normalizeSupplyPayload = (body) => ({
  name: String(body.name || "").trim().replace(/\s+/g, " "),
  category: String(body.category || "").trim(),
  unit: String(body.unit || "").trim().toLowerCase(),
  stock: toNonNegativeNumber(body.stock),
  minimumStock: toNonNegativeNumber(body.minimumStock),
  supplier: String(body.supplier || "").trim(),
  isUnlimited: Boolean(body.isUnlimited),
});

const validateSupplyPayload = async ({ name, category, unit }) => {
  if (!name || name.length > 150 || unit.length > 30) {
    return createHttpError(400, "Nama barang wajib diisi, maksimal 150 karakter.");
  }
  if (!SupplyItem.SUPPLY_CATEGORIES.includes(category)) {
    return createHttpError(400, `Kategori harus ${SupplyItem.SUPPLY_CATEGORIES.join(", ")}.`);
  }
  if ((await SupplyItem.isRawItemName(name)) || (await isSemiItemName(name))) {
    return createHttpError(409, `${name} sudah dipakai di bahan baku atau bahan setengah jadi. Pilih nama lain.`);
  }
  return null;
};

const rethrowDuplicateName = (name) => (error) => {
  if (isDuplicateEntryError(error)) {
    throw createHttpError(409, `${name} sudah tercatat sebagai barang Lainnya.`);
  }
  throw error;
};

const emitSupplyChanged = (action, supplyItemId) =>
  emitRealtimeEvent("stock:changed", { action, supplyItemId });

const getSupplyItems = asyncHandler(async (_req, res) => {
  res.status(200).json({ success: true, data: await SupplyItem.findAll() });
});

const addSupplyItem = asyncHandler(async (req, res, next) => {
  const payload = normalizeSupplyPayload(req.body);
  const validationError = await validateSupplyPayload(payload);
  if (validationError) return next(validationError);

  const item = await SupplyItem.create(payload).catch(rethrowDuplicateName(payload.name));
  emitSupplyChanged("supply-item-created", item.id);
  res.status(201).json({ success: true, data: item });
});

const updateSupplyItem = asyncHandler(async (req, res, next) => {
  const payload = normalizeSupplyPayload(req.body);
  const validationError = await validateSupplyPayload(payload);
  if (validationError) return next(validationError);

  const item = await SupplyItem.update(req.params.id, payload).catch(rethrowDuplicateName(payload.name));
  if (!item) return next(createHttpError(404, "Barang lainnya tidak ditemukan."));

  emitSupplyChanged("supply-item-updated", item.id);
  res.status(200).json({ success: true, data: item });
});

const updateSupplyStock = asyncHandler(async (req, res, next) => {
  const item = await SupplyItem.updateStock(req.params.id, toNonNegativeNumber(req.body.stock));
  if (!item) return next(createHttpError(404, "Barang lainnya tidak ditemukan."));

  emitSupplyChanged("supply-stock-updated", item.id);
  res.status(200).json({ success: true, data: item });
});

const deleteSupplyItem = asyncHandler(async (req, res, next) => {
  const deleted = await SupplyItem.remove(req.params.id);
  if (!deleted) return next(createHttpError(404, "Barang lainnya tidak ditemukan."));

  emitSupplyChanged("supply-item-deleted", Number(req.params.id));
  res.status(200).json({ success: true, message: "Barang lainnya dihapus." });
});

module.exports = {
  addSupplyItem,
  deleteSupplyItem,
  getSupplyItems,
  updateSupplyItem,
  updateSupplyStock,
};
