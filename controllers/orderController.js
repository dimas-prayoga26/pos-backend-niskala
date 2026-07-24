const createHttpError = require("http-errors");
const Order = require("../models/orderModel");
const { emitRealtimeEvent } = require("../config/socket");

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
  deleteOrder,
  getOrderById,
  getOrders,
  updateOrder,
  updateCateringPaymentStatus,
};
