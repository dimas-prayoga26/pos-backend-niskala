const express = require("express");
const authenticate = require("../../shared/middleware/authenticate");
const { requireRole } = require("../../shared/middleware/authorize");
const {
  createPurchase,
  createSupplier,
  deletePurchaseItem,
  getPurchases,
  getSuppliers,
  updatePurchaseItem,
  updateSupplier,
} = require("./shopping.controller");

const router = express.Router();
const adminOnly = requireRole("admin", "Hanya admin yang bisa mengelola belanja dan suplier.");

router.use(authenticate);
router.get("/suppliers", getSuppliers);
router.post("/suppliers", adminOnly, createSupplier);
router.put("/suppliers/:id", adminOnly, updateSupplier);
router.get("/purchases", getPurchases);
router.post("/purchases", adminOnly, createPurchase);
router.put("/purchase-items/:id", adminOnly, updatePurchaseItem);
router.delete("/purchase-items/:id", adminOnly, deletePurchaseItem);

module.exports = router;
