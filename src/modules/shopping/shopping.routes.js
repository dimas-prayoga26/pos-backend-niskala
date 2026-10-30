const express = require("express");
const authenticate = require("../../shared/middleware/authenticate");
const { requireRole } = require("../../shared/middleware/authorize");
const { requireNumericId } = require("../../shared/middleware/validateParams");
const {
  addPurchaseAttachments,
  addSupplyPurchaseAttachments,
  createPurchase,
  createSupplier,
  createSupplyPurchase,
  deletePurchaseAttachment,
  deletePurchaseDraft,
  deletePurchaseItem,
  deleteSupplyPurchaseAttachment,
  deleteSupplyPurchaseDraft,
  deleteSupplyPurchaseItem,
  getPurchaseAttachment,
  getPurchaseDrafts,
  getPurchaseNotas,
  getPurchases,
  getSupplyPurchaseAttachment,
  getSupplyPurchaseDrafts,
  getSupplyPurchaseNotas,
  getSupplyPurchases,
  getShoppingSummary,
  getSuppliers,
  updatePurchaseDraft,
  updatePurchaseItem,
  updateSupplier,
  updateSupplyPurchaseDraft,
  updateSupplyPurchaseItem,
} = require("./shopping.controller");
const { receivePurchaseReceipts } = require("./shopping.upload");

const router = express.Router();
const adminOnly = requireRole("admin", "Hanya admin yang bisa mengelola belanja dan suplier.");
// Staff (admin or kasir) may save and change drafts; the controllers let only
// admins post a nota or change the photos of a posted one.
const staffOnly = requireRole(["admin", "cashier"], "Hanya admin atau kasir yang bisa mencatat belanja.");

router.use(authenticate);
router.get("/suppliers", getSuppliers);
// Summary cards of the Belanja page (?from=&to=).
router.get("/summary", getShoppingSummary);
router.post("/suppliers", adminOnly, createSupplier);
router.put("/suppliers/:id", adminOnly, updateSupplier);

// Belanja bahan baku (stock_raw_items).
router.get("/purchases", getPurchases);
router.get("/purchases/notas", getPurchaseNotas);
router.get("/purchases/drafts", staffOnly, getPurchaseDrafts);
router.post("/purchases", staffOnly, createPurchase);
router.put("/purchases/:id", staffOnly, requireNumericId(), updatePurchaseDraft);
router.delete("/purchases/:id", staffOnly, requireNumericId(), deletePurchaseDraft);
// The role check runs before multer so rejected uploads are never read.
router.post("/purchases/:id/attachments", staffOnly, requireNumericId(), receivePurchaseReceipts, addPurchaseAttachments);
router.get("/purchase-attachments/:id", requireNumericId(), getPurchaseAttachment);
router.delete("/purchase-attachments/:id", staffOnly, requireNumericId(), deletePurchaseAttachment);
router.put("/purchase-items/:id", adminOnly, updatePurchaseItem);
router.delete("/purchase-items/:id", adminOnly, deletePurchaseItem);

// Belanja lainnya (stock_supply_items): peralatan, perlengkapan, promosi, lain-lain.
// GET takes ?category= for the Belanja tabs.
router.get("/supply-purchases", getSupplyPurchases);
router.get("/supply-purchases/notas", getSupplyPurchaseNotas);
router.get("/supply-purchases/drafts", staffOnly, getSupplyPurchaseDrafts);
router.post("/supply-purchases", staffOnly, createSupplyPurchase);
router.put("/supply-purchases/:id", staffOnly, requireNumericId(), updateSupplyPurchaseDraft);
router.delete("/supply-purchases/:id", staffOnly, requireNumericId(), deleteSupplyPurchaseDraft);
router.post("/supply-purchases/:id/attachments", staffOnly, requireNumericId(), receivePurchaseReceipts, addSupplyPurchaseAttachments);
router.get("/supply-purchase-attachments/:id", requireNumericId(), getSupplyPurchaseAttachment);
router.delete("/supply-purchase-attachments/:id", staffOnly, requireNumericId(), deleteSupplyPurchaseAttachment);
router.put("/supply-purchase-items/:id", adminOnly, requireNumericId(), updateSupplyPurchaseItem);
router.delete("/supply-purchase-items/:id", adminOnly, requireNumericId(), deleteSupplyPurchaseItem);

module.exports = router;
