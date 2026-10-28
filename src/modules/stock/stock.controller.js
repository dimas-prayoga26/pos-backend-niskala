const createHttpError = require("http-errors");
const { emitRealtimeEvent } = require("../../infrastructure/realtime/socket");
const asyncHandler = require("../../shared/http/asyncHandler");
const { roundRecipeQuantity } = require("../menu/menu.options");
const StockItem = require("./stock.repository");

const toNonNegativeNumber = (value) => Math.max(Number(value) || 0, 0);

const normalizeStockPayload = (body) => ({
  name: String(body.name || "").trim(),
  category: String(body.category || "").trim(),
  unit: String(body.unit || "").trim(),
  stock: toNonNegativeNumber(body.stock),
  minimumStock: toNonNegativeNumber(body.minimumStock),
  supplier: String(body.supplier || "").trim(),
  isUnlimited: Boolean(body.isUnlimited),
});

const validateStockPayload = ({ name, category, unit }) => {
  if (!name || !category || !unit) {
    return createHttpError(400, "Name, category, and unit are required!");
  }

  return null;
};

const emitStockChanged = (action, stockItemId) =>
  emitRealtimeEvent("stock:changed", { action, stockItemId });

// Prepared item (bahan olahan) request: one batch made from raw stock items
// (quantities in each item's unit) yields yieldQuantity units. Repeated
// components are summed.
const normalizePreparedPayload = (body) => {
  const quantityByStockItemId = new Map();

  for (const component of Array.isArray(body.components) ? body.components : []) {
    const stockItemId = Number(component?.stockItemId || component?.stock_item_id) || 0;
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
    unit: String(body.unit || "").trim(),
    yieldQuantity: roundRecipeQuantity(body.yieldQuantity),
    components: [...quantityByStockItemId].map(([stockItemId, quantity]) => ({
      stockItemId,
      quantity,
    })),
  };
};

const validatePreparedPayload = async ({ name, unit, yieldQuantity, components }, id) => {
  if (!name || !unit) {
    return createHttpError(400, "Nama dan satuan hasil wajib diisi.");
  }
  if (!(yieldQuantity > 0)) {
    return createHttpError(400, "Hasil per resep harus lebih dari 0.");
  }
  if (!components.length) {
    return createHttpError(400, "Isi minimal satu bahan beserta takarannya.");
  }

  const ids = components.map((component) => component.stockItemId);
  if (id && ids.includes(id)) {
    return createHttpError(400, "Bahan olahan tidak bisa memakai dirinya sendiri.");
  }

  const kinds = await StockItem.findKinds(ids);
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
      savedId = await StockItem.savePrepared(id, payload);
    } catch (error) {
      if (error.code === "ER_DUP_ENTRY") {
        return next(createHttpError(409, "Nama bahan sudah dipakai. Pilih nama lain."));
      }
      throw error;
    }

    if (!savedId) {
      return next(createHttpError(404, "Bahan olahan tidak ditemukan."));
    }

    emitStockChanged(isUpdate ? "prepared-item-updated" : "prepared-item-created", savedId);
    res.status(isUpdate ? 200 : 201).json({
      success: true,
      message: isUpdate ? "Bahan olahan diperbarui." : "Bahan olahan ditambahkan.",
      data: await StockItem.findById(savedId),
    });
  });

const addPreparedItem = savePreparedItem(false);
const updatePreparedItem = savePreparedItem(true);

// Prepared items have no stock or COGS of their own; they are edited through
// the prepared item form instead.
const rejectPrepared = async (id, message) => {
  const stockItem = await StockItem.findById(id);
  return stockItem?.isPrepared ? createHttpError(400, message) : null;
};

const getStockItems = asyncHandler(async (_req, res) => {
  const stockItems = await StockItem.findAll();

  res.status(200).json({ success: true, data: stockItems });
});

const addStockItem = asyncHandler(async (req, res, next) => {
  const payload = normalizeStockPayload(req.body);
  const validationError = validateStockPayload(payload);

  if (validationError) return next(validationError);

  const stockItem = await StockItem.create(payload);

  emitStockChanged("stock-item-created", stockItem.id);
  res.status(201).json({
    success: true,
    message: "Stock item added!",
    data: stockItem,
  });
});

const updateStockItem = asyncHandler(async (req, res, next) => {
  const payload = normalizeStockPayload(req.body);
  const validationError =
    validateStockPayload(payload) ||
    (await rejectPrepared(req.params.id, "Ubah bahan olahan lewat form bahan olahan."));

  if (validationError) return next(validationError);

  const stockItem = await StockItem.update(req.params.id, payload);

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
  const preparedError = await rejectPrepared(
    req.params.id,
    "Bahan olahan tidak punya stok sendiri; stok bahan-bahannya yang berkurang."
  );
  if (preparedError) return next(preparedError);

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
  const preparedError = await rejectPrepared(
    req.params.id,
    "COGS bahan olahan dihitung otomatis dari bahan-bahannya."
  );
  if (preparedError) return next(preparedError);

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

  const preparedItemNames = await StockItem.findPreparedItemNames(id);
  if (preparedItemNames.length) {
    return next(
      createHttpError(
        409,
        `Bahan masih dipakai di bahan olahan: ${preparedItemNames.join(", ")}. Hapus dari komposisinya terlebih dahulu.`
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
  addPreparedItem,
  addStockItem,
  deleteStockItem,
  getStockItems,
  updatePreparedItem,
  updateStockCogs,
  updateStockItem,
  updateStockQuantity,
};
