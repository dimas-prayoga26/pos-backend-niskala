const express = require("express");
const authenticate = require("../../shared/middleware/authenticate");
const { requireRole } = require("../../shared/middleware/authorize");
const { requireNumericId } = require("../../shared/middleware/validateParams");
const {
  addCateringPayment,
  addOrder,
  deleteOrder,
  getOrderById,
  getOrders,
  updateCateringPaymentStatus,
  updateOrder,
} = require("./order.controller");
const {
  createDraftThermalPrintUrl,
  createThermalPrintUrl,
  getDraftThermalPrintDocument,
  getThermalPrintDocument,
} = require("./orderPrint.controller");

const router = express.Router();
const validId = requireNumericId();
const staff = ["admin", "cashier"];

router.post("/", authenticate, addOrder);
router.get("/", authenticate, getOrders);

// Thermal print documents are fetched by the RawBT app without a session.
router.post("/draft/thermal-print-url", authenticate, createDraftThermalPrintUrl);
router.get("/draft/thermal-print/:token", getDraftThermalPrintDocument);
router.post("/:id/thermal-print-url", authenticate, validId, createThermalPrintUrl);
router.get("/:id/thermal-print/:token", validId, getThermalPrintDocument);

router.put(
  "/:id/catering-payment",
  authenticate,
  validId,
  requireRole(staff, "Only admin or cashier can update catering payment status!"),
  updateCateringPaymentStatus
);
router.patch(
  "/:id/catering-payment/add",
  authenticate,
  validId,
  requireRole(staff, "Only admin or cashier can add catering payment!"),
  addCateringPayment
);
router.get("/:id", authenticate, validId, getOrderById);
router.put(
  "/:id",
  authenticate,
  validId,
  requireRole("cashier", "Only cashier can update order status!"),
  updateOrder
);
router.delete(
  "/:id",
  authenticate,
  validId,
  requireRole(staff, "Only admin or cashier can delete orders!"),
  deleteOrder
);

module.exports = router;
