const createHttpError = require("http-errors");
const StockItem = require("../models/stockItemModel");
const { emitRealtimeEvent } = require("../config/socket");

const normalizeStockPayload = (body) => ({
  name: String(body.name || "").trim(),
  category: String(body.category || "").trim(),
  unit: String(body.unit || "").trim(),
  stock: Math.max(Number(body.stock) || 0, 0),
  minimumStock: Math.max(Number(body.minimumStock) || 0, 0),
  supplier: String(body.supplier || "").trim(),
});

const validateStockPayload = ({ name, category, unit }) => {
  if (!name || !category || !unit) {
    return createHttpError(400, "Name, category, and unit are required!");
  }

  return null;
};

const getUserRole = (req) => req.user?.role?.toLowerCase();

const requireAdmin = (req, next) => {
  if (getUserRole(req) !== "admin") {
    return createHttpError(403, "Only admin can manage stock items!");
  }

  return null;
};

const addStockItem = async (req, res, next) => {
  try {
    const permissionError = requireAdmin(req, next);
    if (permissionError) return next(permissionError);

    const payload = normalizeStockPayload(req.body);
    const validationError = validateStockPayload(payload);

    if (validationError) return next(validationError);

    const stockItem = await StockItem.create(payload);

    emitRealtimeEvent("stock:changed", {
      action: "stock-item-created",
      stockItemId: stockItem.id || stockItem._id,
    });
    res.status(201).json({
      success: true,
      message: "Stock item added!",
      data: stockItem,
    });
  } catch (error) {
    next(error);
  }
};

const getStockItems = async (_req, res, next) => {
  try {
    const stockItems = await StockItem.findAll();
    res.status(200).json({ success: true, data: stockItems });
  } catch (error) {
    next(error);
  }
};

const updateStockItem = async (req, res, next) => {
  try {
    const permissionError = requireAdmin(req, next);
    if (permissionError) return next(permissionError);

    const { id } = req.params;
    const payload = normalizeStockPayload(req.body);
    const validationError = validateStockPayload(payload);

    if (!Number(id)) {
      return next(createHttpError(404, "Invalid id!"));
    }

    if (validationError) return next(validationError);

    const stockItem = await StockItem.update(id, payload);

    if (!stockItem) {
      return next(createHttpError(404, "Stock item not found!"));
    }

    emitRealtimeEvent("stock:changed", {
      action: "stock-item-updated",
      stockItemId: stockItem.id || stockItem._id,
    });
    res.status(200).json({
      success: true,
      message: "Stock item updated!",
      data: stockItem,
    });
  } catch (error) {
    next(error);
  }
};

const updateStockQuantity = async (req, res, next) => {
  try {
    const { id } = req.params;
    const stock = Math.max(Number(req.body.stock) || 0, 0);
    const role = getUserRole(req);

    if (!Number(id)) {
      return next(createHttpError(404, "Invalid id!"));
    }

    if (!["admin", "cashier"].includes(role)) {
      return next(createHttpError(403, "Only admin or cashier can update stock!"));
    }

    const stockItem = await StockItem.updateStock(id, stock);

    if (!stockItem) {
      return next(createHttpError(404, "Stock item not found!"));
    }

    emitRealtimeEvent("stock:changed", {
      action: "stock-quantity-updated",
      stockItemId: stockItem.id || stockItem._id,
    });
    res.status(200).json({
      success: true,
      message: "Stock updated!",
      data: stockItem,
    });
  } catch (error) {
    next(error);
  }
};

const deleteStockItem = async (req, res, next) => {
  try {
    const permissionError = requireAdmin(req, next);
    if (permissionError) return next(permissionError);

    const { id } = req.params;

    if (!Number(id)) {
      return next(createHttpError(404, "Invalid id!"));
    }

    const deleted = await StockItem.remove(id);

    if (!deleted) {
      return next(createHttpError(404, "Stock item not found!"));
    }

    emitRealtimeEvent("stock:changed", {
      action: "stock-item-deleted",
      stockItemId: Number(id),
    });
    res.status(200).json({ success: true, message: "Stock item deleted!" });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  addStockItem,
  deleteStockItem,
  getStockItems,
  updateStockItem,
  updateStockQuantity,
};
