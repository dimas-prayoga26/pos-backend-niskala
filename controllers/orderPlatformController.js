const createHttpError = require("http-errors");
const OrderPlatform = require("../models/orderPlatformModel");
const { emitRealtimeEvent } = require("../config/socket");

const requireAdmin = (req, next) => {
  if (req.user?.role?.toLowerCase() !== "admin") {
    return createHttpError(403, "Only admin can manage order platforms!");
  }

  return null;
};

const normalizePlatformPayload = (body) => ({
  name: String(body.name || "").trim(),
  iconUrl: String(body.iconUrl || body.icon_url || "").trim(),
  isActive: body.isActive !== false,
});

const getOrderPlatforms = async (req, res, next) => {
  try {
    const includeInactive =
      req.query.includeInactive === "true" &&
      req.user?.role?.toLowerCase() === "admin";
    const orderPlatforms = await OrderPlatform.findAll({ includeInactive });

    res.status(200).json({ success: true, data: orderPlatforms });
  } catch (error) {
    next(error);
  }
};

const addOrderPlatform = async (req, res, next) => {
  try {
    const permissionError = requireAdmin(req, next);
    if (permissionError) return next(permissionError);

    const payload = normalizePlatformPayload(req.body);

    if (!payload.name) {
      return next(createHttpError(400, "Platform name is required!"));
    }

    const platform = await OrderPlatform.create(payload);
    emitRealtimeEvent("platforms:changed", {
      action: "platform-created",
      platformId: platform.id || platform._id,
    });

    res.status(201).json({
      success: true,
      message: "Order platform added!",
      data: platform,
    });
  } catch (error) {
    if (error?.code === "ER_DUP_ENTRY") {
      return next(createHttpError(409, "Platform name already exists!"));
    }

    next(error);
  }
};

const updateOrderPlatform = async (req, res, next) => {
  try {
    const permissionError = requireAdmin(req, next);
    if (permissionError) return next(permissionError);

    const { id } = req.params;
    const payload = normalizePlatformPayload(req.body);

    if (!Number(id)) {
      return next(createHttpError(404, "Invalid id!"));
    }

    if (!payload.name) {
      return next(createHttpError(400, "Platform name is required!"));
    }

    const platform = await OrderPlatform.update(id, payload);

    if (!platform) {
      return next(createHttpError(404, "Platform not found!"));
    }

    emitRealtimeEvent("platforms:changed", {
      action: "platform-updated",
      platformId: platform.id || platform._id,
    });

    res.status(200).json({
      success: true,
      message: "Order platform updated!",
      data: platform,
    });
  } catch (error) {
    if (error?.code === "ER_DUP_ENTRY") {
      return next(createHttpError(409, "Platform name already exists!"));
    }

    next(error);
  }
};

const deleteOrderPlatform = async (req, res, next) => {
  try {
    const permissionError = requireAdmin(req, next);
    if (permissionError) return next(permissionError);

    const { id } = req.params;

    if (!Number(id)) {
      return next(createHttpError(404, "Invalid id!"));
    }

    const deleted = await OrderPlatform.deactivate(id);

    if (!deleted) {
      return next(createHttpError(404, "Platform not found!"));
    }

    emitRealtimeEvent("platforms:changed", {
      action: "platform-deactivated",
      platformId: Number(id),
    });

    res.status(200).json({
      success: true,
      message: "Order platform deactivated!",
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  addOrderPlatform,
  deleteOrderPlatform,
  getOrderPlatforms,
  updateOrderPlatform,
};
