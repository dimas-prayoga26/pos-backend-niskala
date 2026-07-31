const express = require("express");
const {
  addCateringPayment,
  addOrder,
  createThermalPrintUrl,
  deleteOrder,
  getOrders,
  getOrderById,
  getThermalPrintDocument,
  updateOrder,
  updateCateringPaymentStatus,
} = require("../controllers/orderController");
const { isVerifiedUser } = require("../middlewares/tokenVerification");
const router = express.Router();


router.route("/").post(isVerifiedUser, addOrder);
router.route("/").get(isVerifiedUser, getOrders);
router
  .route("/:id/thermal-print-url")
  .post(isVerifiedUser, createThermalPrintUrl);
router.route("/:id/thermal-print/:token").get(getThermalPrintDocument);
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
