const createHttpError = require("http-errors");
const { emitRealtimeEvent } = require("../../infrastructure/realtime/socket");
const asyncHandler = require("../../shared/http/asyncHandler");
const { isAdmin } = require("../../shared/middleware/authorize");
const { isDuplicateEntryError } = require("../../shared/utils/dbErrors");
const OrderPlatform = require("./platform.repository");

const normalizePlatformPayload = (body) => ({
  name: String(body.name || "").trim(),
  iconUrl: String(body.iconUrl || body.icon_url || "").trim(),
  tax: body.tax ?? body.taxRate ?? body.platformTax ?? 0,
  isActive: body.isActive !== false,
});

const rethrowDuplicateName = (error) => {
  if (isDuplicateEntryError(error)) {
    throw createHttpError(409, "Platform name already exists!");
  }

  throw error;
};

const getOrderPlatforms = asyncHandler(async (req, res) => {
  const includeInactive = req.query.includeInactive === "true" && isAdmin(req);
  const orderPlatforms = await OrderPlatform.findAll({ includeInactive });

  res.status(200).json({ success: true, data: orderPlatforms });
});

const addOrderPlatform = asyncHandler(async (req, res, next) => {
  const payload = normalizePlatformPayload(req.body);

  if (!payload.name) {
    return next(createHttpError(400, "Platform name is required!"));
  }

  const platform = await OrderPlatform.create(payload).catch(rethrowDuplicateName);
  emitRealtimeEvent("platforms:changed", {
    action: "platform-created",
    platformId: platform.id,
  });

  res.status(201).json({
    success: true,
    message: "Order platform added!",
    data: platform,
  });
});

const updateOrderPlatform = asyncHandler(async (req, res, next) => {
  const payload = normalizePlatformPayload(req.body);

  if (!payload.name) {
    return next(createHttpError(400, "Platform name is required!"));
  }

  const platform = await OrderPlatform.update(req.params.id, payload).catch(
    rethrowDuplicateName
  );

  if (!platform) {
    return next(createHttpError(404, "Platform not found!"));
  }

  emitRealtimeEvent("platforms:changed", {
    action: "platform-updated",
    platformId: platform.id,
  });

  res.status(200).json({
    success: true,
    message: "Order platform updated!",
    data: platform,
  });
});

// Platforms are only deactivated: historical orders keep referencing them.
const deleteOrderPlatform = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
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
});

module.exports = {
  addOrderPlatform,
  deleteOrderPlatform,
  getOrderPlatforms,
  updateOrderPlatform,
};
