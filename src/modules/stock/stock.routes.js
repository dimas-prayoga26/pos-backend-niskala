const express = require("express");
const authenticate = require("../../shared/middleware/authenticate");
const { requireRole } = require("../../shared/middleware/authorize");
const { requireNumericId } = require("../../shared/middleware/validateParams");
const {
  addStockItem,
  deleteStockItem,
  getStockItems,
  updateStockCogs,
  updateStockItem,
  updateStockQuantity,
} = require("./stock.controller");
const {
  addPreparedItem,
  deleteProduction,
  getProductions,
  recordProduction,
  updatePreparedItem,
} = require("./prepared.controller");

const router = express.Router();
const adminOnly = requireRole("admin", "Only admin can manage stock items!");
const staffOnly = requireRole(["admin", "cashier"], "Only admin or cashier can update stock!");

router.get("/", authenticate, getStockItems);
router.post("/", authenticate, adminOnly, addStockItem);
// Prepared items (bahan olahan) and their cooking ("Catat Masak").
router.post("/prepared", authenticate, adminOnly, addPreparedItem);
router.put("/:id/prepared", authenticate, adminOnly, requireNumericId(), updatePreparedItem);
router.get("/:id/productions", authenticate, requireNumericId(), getProductions);
router.post("/:id/productions", authenticate, requireNumericId(), staffOnly, recordProduction);
router.delete(
  "/productions/:productionId",
  authenticate,
  adminOnly,
  requireNumericId({ param: "productionId" }),
  deleteProduction
);
router.put("/:id", authenticate, adminOnly, requireNumericId(), updateStockItem);
router.delete("/:id", authenticate, adminOnly, requireNumericId(), deleteStockItem);
router.patch("/:id/cogs", authenticate, adminOnly, requireNumericId(), updateStockCogs);
router.patch("/:id/stock", authenticate, requireNumericId(), staffOnly, updateStockQuantity);

module.exports = router;
