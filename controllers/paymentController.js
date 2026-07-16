const midtransClient = require("midtrans-client");
const config = require("../config/config");
const crypto = require("crypto");
const createHttpError = require("http-errors");
const Payment = require("../models/paymentModel");

const createMidtransSnap = () =>
  new midtransClient.Snap({
    isProduction: config.midtransIsProduction,
    serverKey: config.midtransServerKey,
    clientKey: config.midtransClientKey,
  });

const createMidtransCore = () =>
  new midtransClient.CoreApi({
    isProduction: config.midtransIsProduction,
    serverKey: config.midtransServerKey,
    clientKey: config.midtransClientKey,
  });

const createOrder = async (req, res, next) => {
  try {
    const { amount, customerDetails } = req.body;
    const grossAmount = Math.round(Number(amount));

    if (!config.midtransServerKey || !config.midtransClientKey) {
      return next(createHttpError(500, "Midtrans keys are not configured"));
    }

    if (!grossAmount || grossAmount < 1) {
      return next(createHttpError(400, "Invalid payment amount"));
    }

    const orderId = `POS-${Date.now()}`;
    const transaction = await createMidtransSnap().createTransaction({
      transaction_details: {
        order_id: orderId,
        gross_amount: grossAmount,
      },
      customer_details: {
        first_name: customerDetails?.name || "POS Customer",
      },
    });

    res.status(200).json({
      success: true,
      transaction: {
        token: transaction.token,
        redirect_url: transaction.redirect_url,
        order_id: orderId,
        gross_amount: grossAmount,
      },
    });
  } catch (error) {
    next(error);
  }
};

const verifyPayment = async (req, res, next) => {
  try {
    const { order_id } = req.body;

    if (!order_id) {
      return next(createHttpError(400, "Midtrans order ID is required"));
    }

    const transactionStatus = await createMidtransCore().transaction.status(
      order_id
    );
    const paidStatuses = ["capture", "settlement"];

    if (!paidStatuses.includes(transactionStatus.transaction_status)) {
      return next(createHttpError(400, "Payment is not completed yet"));
    }

    res.json({
      success: true,
      message: "Payment verified successfully!",
      transaction: transactionStatus,
    });
  } catch (error) {
    next(error);
  }
};

const webHookVerification = async (req, res, next) => {
  try {
    const notification = req.body;
    const signatureKey = crypto
      .createHash("sha512")
      .update(
        `${notification.order_id}${notification.status_code}${notification.gross_amount}${config.midtransServerKey}`
      )
      .digest("hex");

    if (signatureKey !== notification.signature_key) {
      return next(createHttpError(400, "Invalid Midtrans signature"));
    }

    if (
      ["capture", "settlement", "pending"].includes(
        notification.transaction_status
      )
    ) {
      await Payment.create({
        paymentId: notification.transaction_id,
        orderId: notification.order_id,
        amount: Number(notification.gross_amount),
        currency: notification.currency,
        status: notification.transaction_status,
        method: notification.payment_type,
        email: notification.email,
        contact: notification.phone,
        createdAt: new Date(notification.transaction_time),
      });
    }

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
};

module.exports = { createOrder, verifyPayment, webHookVerification };
