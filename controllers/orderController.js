const createHttpError = require("http-errors");
const Order = require("../models/orderModel");
const { emitRealtimeEvent } = require("../config/socket");
const {
  RECEIPT_PRINT_TTL_MS,
  createReceiptPrintJob,
  consumeReceiptPrintJob,
} = require("../utils/receiptPrintStore");

const getRequestOrigin = (req) => {
  const forwardedProto = req.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = req.get("x-forwarded-host")?.split(",")[0]?.trim();
  const protocol = forwardedProto || req.protocol;
  const host = forwardedHost || req.get("host");

  if (!host) return "";

  return `${protocol}://${host}`;
};

const addOrder = async (req, res, next) => {
  try {
    if (req.body?.orderType === "Online" && !req.body?.orderPlatform) {
      return next(createHttpError(400, "Online order platform is required!"));
    }

    const order = await Order.create(req.body);
    emitRealtimeEvent("orders:changed", {
      action: "created",
      orderId: order.id || order._id,
    });
    emitRealtimeEvent("stock:changed", {
      action: "stock-deducted-by-order",
      orderId: order.id || order._id,
    });
    res
      .status(201)
      .json({ success: true, message: "Order created!", data: order });
  } catch (error) {
    next(error);
  }
};

const getOrderById = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!Number(id)) {
      const error = createHttpError(404, "Invalid id!");
      return next(error);
    }

    const order = await Order.findById(id);
    if (!order) {
      const error = createHttpError(404, "Order not found!");
      return next(error);
    }

    res.status(200).json({ success: true, data: order });
  } catch (error) {
    next(error);
  }
};

const getOrders = async (req, res, next) => {
  try {
    const orders = await Order.findAll();
    res.status(200).json({ data: orders });
  } catch (error) {
    next(error);
  }
};

const createReceiptPrintUrl = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { documentHtml } = req.body || {};

    if (!Number(id)) {
      const error = createHttpError(404, "Invalid id!");
      return next(error);
    }

    const order = await Order.findById(id);
    if (!order) {
      const error = createHttpError(404, "Order not found!");
      return next(error);
    }

    const token = createReceiptPrintJob({
      orderId: id,
      documentHtml,
      userId: req.user?._id || req.user?.id,
    });
    const origin = getRequestOrigin(req);

    if (!origin) {
      const error = createHttpError(500, "Unable to build receipt print URL.");
      return next(error);
    }

    res.status(201).json({
      success: true,
      data: {
        expiresInSeconds: Math.floor(RECEIPT_PRINT_TTL_MS / 1000),
        url: `${origin}/api/order/${id}/receipt-print/${token}`,
      },
    });
  } catch (error) {
    next(error);
  }
};

const getReceiptPrintDocument = async (req, res, next) => {
  try {
    const { id, token } = req.params;

    if (!Number(id)) {
      const error = createHttpError(404, "Invalid id!");
      return next(error);
    }

    const job = consumeReceiptPrintJob({ orderId: id, token });

    if (!job) {
      const error = createHttpError(404, "Receipt print URL expired or invalid.");
      return next(error);
    }

    res.set({
      "Cache-Control": "no-store, private",
      "Content-Security-Policy":
        "default-src 'none'; img-src 'self' data: https: http:; style-src 'unsafe-inline';",
      "Content-Type": "text/html; charset=utf-8",
      "X-Robots-Tag": "noindex, nofollow",
    });
    res.status(200).send(job.documentHtml);
  } catch (error) {
    next(error);
  }
};

const updateOrder = async (req, res, next) => {
  try {
    const { orderStatus } = req.body;
    const { id } = req.params;
    const role = req.user?.role?.toLowerCase();

    if (!Number(id)) {
      const error = createHttpError(404, "Invalid id!");
      return next(error);
    }

    if (role !== "cashier") {
      const error = createHttpError(403, "Only cashier can update order status!");
      return next(error);
    }

    if (!["In Progress", "Completed"].includes(orderStatus)) {
      const error = createHttpError(400, "Invalid order status!");
      return next(error);
    }

    const order = await Order.updateStatus(id, orderStatus);

    if (!order) {
      const error = createHttpError(404, "Order not found!");
      return next(error);
    }

    emitRealtimeEvent("orders:changed", {
      action: "updated",
      orderId: order.id || order._id,
    });
    res
      .status(200)
      .json({ success: true, message: "Order updated", data: order });
  } catch (error) {
    next(error);
  }
};

const updateCateringPaymentStatus = async (req, res, next) => {
  try {
    const { isPaid } = req.body;
    const { id } = req.params;
    const role = req.user?.role?.toLowerCase();

    if (!Number(id)) {
      const error = createHttpError(404, "Invalid id!");
      return next(error);
    }

    if (!["admin", "cashier"].includes(role)) {
      const error = createHttpError(
        403,
        "Only admin or cashier can update catering payment status!"
      );
      return next(error);
    }

    if (typeof isPaid !== "boolean") {
      const error = createHttpError(400, "Invalid payment status!");
      return next(error);
    }

    const order = await Order.updateCateringPaidStatus(id, isPaid);

    if (!order) {
      const error = createHttpError(404, "Catering order not found!");
      return next(error);
    }

    emitRealtimeEvent("orders:changed", {
      action: "catering-payment-updated",
      orderId: order.id || order._id,
    });
    res.status(200).json({
      success: true,
      message: isPaid ? "Catering order marked as paid" : "Catering order marked as unpaid",
      data: order,
    });
  } catch (error) {
    next(error);
  }
};

const addCateringPayment = async (req, res, next) => {
  try {
    const { amount } = req.body;
    const { id } = req.params;
    const role = req.user?.role?.toLowerCase();

    if (!Number(id)) {
      const error = createHttpError(404, "Invalid id!");
      return next(error);
    }

    if (!["admin", "cashier"].includes(role)) {
      const error = createHttpError(
        403,
        "Only admin or cashier can add catering payment!"
      );
      return next(error);
    }

    const paymentAmount = Number(amount);

    if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
      const error = createHttpError(400, "Payment amount must be greater than 0!");
      return next(error);
    }

    const order = await Order.addCateringPayment(id, paymentAmount);

    if (!order) {
      const error = createHttpError(404, "Catering order not found!");
      return next(error);
    }

    emitRealtimeEvent("orders:changed", {
      action: "catering-payment-added",
      orderId: order.id || order._id,
    });
    res.status(200).json({
      success: true,
      message: "Catering payment added",
      data: order,
    });
  } catch (error) {
    next(error);
  }
};

const deleteOrder = async (req, res, next) => {
  try {
    const { id } = req.params;
    const role = req.user?.role?.toLowerCase();

    if (!Number(id)) {
      const error = createHttpError(404, "Invalid id!");
      return next(error);
    }

    if (!["admin", "cashier"].includes(role)) {
      const error = createHttpError(403, "Only admin or cashier can delete orders!");
      return next(error);
    }

    const deleted = await Order.remove(id);

    if (!deleted) {
      const error = createHttpError(404, "Order not found!");
      return next(error);
    }

    emitRealtimeEvent("orders:changed", {
      action: "deleted",
      orderId: Number(id),
    });
    emitRealtimeEvent("stock:changed", {
      action: "stock-restored-by-order-delete",
      orderId: Number(id),
    });

    res.status(200).json({
      success: true,
      message: "Order deleted",
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  addOrder,
  addCateringPayment,
  createReceiptPrintUrl,
  deleteOrder,
  getReceiptPrintDocument,
  getOrderById,
  getOrders,
  updateOrder,
  updateCateringPaymentStatus,
};
