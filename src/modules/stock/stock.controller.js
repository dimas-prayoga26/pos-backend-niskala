const createHttpError = require("http-errors");
const { emitRealtimeEvent } = require("../../infrastructure/realtime/socket");
const asyncHandler = require("../../shared/http/asyncHandler");
const { isDuplicateEntryError } = require("../../shared/utils/dbErrors");
const StockItem = require("./stock.repository");
const { isSupplyItemName } = require("./supply.repository");

const toNonNegativeNumber = (value) => Math.max(Number(value) || 0, 0);

const rethrowDuplicateName = (name) => (error) => {
  if (isDuplicateEntryError(error)) {
    throw createHttpError(409, `Bahan ${name} sudah ada di Stok → Bahan Baku.`);
  }
  throw error;
};

const normalizeStockPayload = (body) => ({
  name: String(body.name || "").trim(),
  category: String(body.category || "").trim(),
  unit: String(body.unit || "").trim(),
  stock: toNonNegativeNumber(body.stock),
  minimumStock: toNonNegativeNumber(body.minimumStock),
  supplier: String(body.supplier || "").trim(),
  isUnlimited: Boolean(body.isUnlimited),
  // Only used on create; the flag has its own endpoint (PATCH /:id/recipe-use).
  isRecipeIngredient: body.isRecipeIngredient === undefined ? true : Boolean(body.isRecipeIngredient),
});

const validateStockPayload = async ({ name, category, unit }) => {
  if (!name || !category || !unit) {
    return createHttpError(400, "Name, category, and unit are required!");
  }

  if (await StockItem.isSemiItemName(name)) {
    return createHttpError(409, `${name} sudah dipakai di bahan setengah jadi. Pilih nama lain.`);
  }

  if (await isSupplyItemName(name)) {
    return createHttpError(409, `${name} sudah tercatat sebagai barang Lainnya. Pilih nama lain.`);
  }

  return null;
};

const emitStockChanged = (action, stockItemId) =>
  emitRealtimeEvent("stock:changed", { action, stockItemId });

const getStockItems = asyncHandler(async (_req, res) => {
  const stockItems = await StockItem.findAll();

  res.status(200).json({ success: true, data: stockItems });
});

const addStockItem = asyncHandler(async (req, res, next) => {
  const payload = normalizeStockPayload(req.body);
  const validationError = await validateStockPayload(payload);

  if (validationError) return next(validationError);

  const stockItem = await StockItem.create(payload).catch(rethrowDuplicateName(payload.name));

  emitStockChanged("stock-item-created", stockItem.id);
  res.status(201).json({
    success: true,
    message: "Stock item added!",
    data: stockItem,
  });
});

const updateStockItem = asyncHandler(async (req, res, next) => {
  const payload = normalizeStockPayload(req.body);
  const validationError = await validateStockPayload(payload);

  if (validationError) return next(validationError);

  const stockItem = await StockItem.update(req.params.id, payload).catch(rethrowDuplicateName(payload.name));

  if (!stockItem) {
    return next(createHttpError(404, "Stock item not found!"));
  }

  emitStockChanged("stock-item-updated", stockItem.id);
  res.status(200).json({
    success: true,
    message: "Stock item updated!",
    data: stockItem,
  });
});

// Manual stock count: also revalues stock_value at the current average cost.
const updateStockQuantity = asyncHandler(async (req, res, next) => {
  const stock = toNonNegativeNumber(req.body.stock);
  const stockItem = await StockItem.updateStock(req.params.id, stock);

  if (!stockItem) {
    return next(createHttpError(404, "Stock item not found!"));
  }

  emitStockChanged("stock-quantity-updated", stockItem.id);
  res.status(200).json({
    success: true,
    message: "Stock updated!",
    data: stockItem,
  });
});

const updateStockCogs = asyncHandler(async (req, res, next) => {
  // Exact cost: stock_value uses it, unit_cost is stored as whole rupiah.
  const averageCost = toNonNegativeNumber(req.body.averageCost);
  const supplier = String(req.body.supplier || "").trim();
  const stockItem = await StockItem.updateCogs(req.params.id, { averageCost, supplier });

  if (!stockItem) {
    return next(createHttpError(404, "Stock item not found!"));
  }

  emitStockChanged("stock-cogs-updated", stockItem.id);
  res.status(200).json({
    success: true,
    message: "COGS stok berhasil diubah.",
    data: stockItem,
  });
});

// Konversi Satuan: { unit, factor }, 1 old unit = factor new units (asked only
// when the units are not converted by the server, e.g. 1 galon = 19000 ml).
const updateStockUnit = asyncHandler(async (req, res, next) => {
  const unit = String(req.body.unit || "").trim().toLowerCase();
  if (!unit || unit.length > 30) return next(createHttpError(400, "Satuan baru wajib diisi (maksimal 30 huruf)."));

  const converted = await StockItem.convertUnit(req.params.id, { unit, factor: req.body.factor });
  if (!converted) return next(createHttpError(404, "Stock item not found!"));

  const { item, fromUnit, factor } = converted;
  const isi = Number(factor).toLocaleString("id-ID", { maximumFractionDigits: 3 });
  emitStockChanged("stock-unit-converted", item.id);
  res.status(200).json({
    success: true,
    message: `Satuan ${item.name} dikonversi: 1 ${fromUnit} = ${isi} ${item.unit}. Stok, resep, dan riwayat belanja ikut disesuaikan.`,
    data: item,
  });
});

// Bahan Resep on/off. A bahan a recipe still uses stays on, so the recipe
// editors keep showing what the recipes contain.
const updateStockRecipeUse = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const isRecipeIngredient = Boolean(req.body.isRecipeIngredient);

  if (!isRecipeIngredient) {
    const usedBy = [
      ...(await StockItem.findRecipeMenuNames(id)),
      ...(await StockItem.findSemiItemNames(id)),
    ];
    if (usedBy.length) {
      return next(
        createHttpError(409, `Bahan masih dipakai di resep: ${usedBy.join(", ")}. Hapus dari resep terlebih dahulu.`)
      );
    }
  }

  const stockItem = await StockItem.setRecipeIngredient(id, isRecipeIngredient);

  if (!stockItem) {
    return next(createHttpError(404, "Stock item not found!"));
  }

  emitStockChanged("stock-recipe-use-updated", stockItem.id);
  res.status(200).json({
    success: true,
    message: isRecipeIngredient ? "Bahan ditandai sebagai bahan resep." : "Bahan tidak lagi ditandai sebagai bahan resep.",
    data: stockItem,
  });
});

const deleteStockItem = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const recipeMenuNames = await StockItem.findRecipeMenuNames(id);

  if (recipeMenuNames.length) {
    return next(
      createHttpError(
        409,
        `Bahan masih dipakai di resep menu: ${recipeMenuNames.join(", ")}. Hapus dari resep terlebih dahulu.`
      )
    );
  }

  const semiItemNames = await StockItem.findSemiItemNames(id);
  if (semiItemNames.length) {
    return next(
      createHttpError(
        409,
        `Bahan masih dipakai di bahan setengah jadi: ${semiItemNames.join(", ")}. Hapus dari komposisinya terlebih dahulu.`
      )
    );
  }

  const deleted = await StockItem.remove(id);

  if (!deleted) {
    return next(createHttpError(404, "Stock item not found!"));
  }

  emitStockChanged("stock-item-deleted", Number(id));
  res.status(200).json({ success: true, message: "Stock item deleted!" });
});

module.exports = {
  addStockItem,
  deleteStockItem,
  getStockItems,
  updateStockCogs,
  updateStockRecipeUse,
  updateStockItem,
  updateStockQuantity,
  updateStockUnit,
};
