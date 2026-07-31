const express = require("express");
const {
  addCateringPayment,
  addOrder,
  createReceiptPrintUrl,
  deleteOrder,
  getReceiptPrintDocument,
  getOrders,
  getOrderById,
  updateOrder,
  updateCateringPaymentStatus,
} = require("../controllers/orderController");
const { isVerifiedUser } = require("../middlewares/tokenVerification");
const router = express.Router();


router.route("/").post(isVerifiedUser, addOrder);
router.route("/").get(isVerifiedUser, getOrders);
router
  .route("/:id/receipt-print-url")
  .post(isVerifiedUser, createReceiptPrintUrl);
router.route("/:id/receipt-print/:token").get(getReceiptPrintDocument);
router
  .route("/:id/catering-payment")
  .put(isVerifiedUser, updateCateringPaymentStatus);
router
  .route("/:id/catering-payment/add")
  .patch(isVerifiedUser, addCateringPayment);
router.route("/:id").get(isVerifiedUser, getOrderById);
router.route("/:id").put(isVerifiedUser, updateOrder);
router.route("/:id").delete(isVerifiedUser, deleteOrder);

module.exports = router;
