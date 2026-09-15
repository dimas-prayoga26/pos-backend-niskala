const express = require("express");
const {
  addCateringPayment,
  addOrder,
  createThermalPrintUrl,
  createDraftThermalPrintUrl,
  getDraftThermalPrintDocument,
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
router.route("/draft/thermal-print-url").post(isVerifiedUser, createDraftThermalPrintUrl);
router.route("/draft/thermal-print/:token").get(getDraftThermalPrintDocument);
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
