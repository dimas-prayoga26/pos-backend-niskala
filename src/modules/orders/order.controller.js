const createHttpError = require("http-errors");
const { emitRealtimeEvent } = require("../../infrastructure/realtime/socket");
const asyncHandler = require("../../shared/http/asyncHandler");
const orderService = require("./order.service");

const ORDER_STATUSES = ["In Progress", "Completed"];

const emitOrderChanged = (action, orderId) =>
  emitRealtimeEvent("orders:changed", { action, orderId });

const addOrder = asyncHandler(async (req, res, next) => {
  if (
    req.body?.orderType === "Online" &&
    !req.body?.orderPlatformId &&
    !req.body?.orderPlatform
  ) {
    return next(createHttpError(400, "Online order platform is required!"));
  }

  const order = await orderService.create(req.body);
  emitOrderChanged("created", order.id);
  emitRealtimeEvent("stock:changed", {
    action: "stock-deducted-by-order",
    orderId: order.id,
  });
  res.status(201).json({ success: true, message: "Order created!", data: order });
});

// The list response has no `success` flag; the frontend reads `data` only.
const getOrders = asyncHandler(async (req, res) => {
  const orders = await orderService.findAll();
  res.status(200).json({ data: orders });
});

const getOrderById = asyncHandler(async (req, res, next) => {
  const order = await orderService.findById(req.params.id);

  if (!order) {
    return next(createHttpError(404, "Order not found!"));
  }

  res.status(200).json({ success: true, data: order });
});

const updateOrder = asyncHandler(async (req, res, next) => {
  const { orderStatus } = req.body;

  if (!ORDER_STATUSES.includes(orderStatus)) {
    return next(createHttpError(400, "Invalid order status!"));
  }

  const order = await orderService.updateStatus(req.params.id, orderStatus);

  if (!order) {
    return next(createHttpError(404, "Order not found!"));
  }

  emitOrderChanged("updated", order.id);
  res.status(200).json({ success: true, message: "Order updated", data: order });
});

const updateCateringPaymentStatus = asyncHandler(async (req, res, next) => {
  const { isPaid } = req.body;

  if (typeof isPaid !== "boolean") {
    return next(createHttpError(400, "Invalid payment status!"));
  }

  const order = await orderService.updateCateringPaidStatus(req.params.id, isPaid);

  if (!order) {
    return next(createHttpError(404, "Catering order not found!"));
  }

  emitOrderChanged("catering-payment-updated", order.id);
  res.status(200).json({
    success: true,
    message: isPaid ? "Catering order marked as paid" : "Catering order marked as unpaid",
    data: order,
  });
});

const addCateringPayment = asyncHandler(async (req, res, next) => {
  const paymentAmount = Number(req.body.amount);

  if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
    return next(createHttpError(400, "Payment amount must be greater than 0!"));
  }

  const order = await orderService.addCateringPayment(req.params.id, paymentAmount);

  if (!order) {
    return next(createHttpError(404, "Catering order not found!"));
  }

  emitOrderChanged("catering-payment-added", order.id);
  res.status(200).json({
    success: true,
    message: "Catering payment added",
    data: order,
  });
});

const deleteOrder = asyncHandler(async (req, res, next) => {
  const id = Number(req.params.id);
  const deleted = await orderService.remove(req.params.id);

  if (!deleted) {
    return next(createHttpError(404, "Order not found!"));
  }

  emitOrderChanged("deleted", id);
  emitRealtimeEvent("stock:changed", {
    action: "stock-restored-by-order-delete",
    orderId: id,
  });

  res.status(200).json({
    success: true,
    message: "Order deleted",
  });
});

module.exports = {
  addCateringPayment,
  addOrder,
  deleteOrder,
  getOrderById,
  getOrders,
  updateCateringPaymentStatus,
  updateOrder,
};
