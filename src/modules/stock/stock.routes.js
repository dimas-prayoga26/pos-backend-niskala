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
  addSemiItem,
  deleteProduction,
  deleteSemiItem,
  getProductions,
  getSemiItems,
  recordProduction,
  updateSemiItem,
  updateSemiStock,
} = require("./semi.controller");

const router = express.Router();
const adminOnly = requireRole("admin", "Only admin can manage stock items!");
const staffOnly = requireRole(["admin", "cashier"], "Only admin or cashier can update stock!");

// Bahan setengah jadi (stock_semi_items) and their cooking ("Catat Masak").
router.get("/semi", authenticate, getSemiItems);
router.post("/semi", authenticate, adminOnly, addSemiItem);
router.delete(
  "/semi/productions/:productionId",
  authenticate,
  adminOnly,
  requireNumericId({ param: "productionId" }),
  deleteProduction
);
router.put("/semi/:id", authenticate, adminOnly, requireNumericId(), updateSemiItem);
router.delete("/semi/:id", authenticate, adminOnly, requireNumericId(), deleteSemiItem);
router.patch("/semi/:id/stock", authenticate, requireNumericId(), staffOnly, updateSemiStock);
router.get("/semi/:id/productions", authenticate, requireNumericId(), getProductions);
router.post("/semi/:id/productions", authenticate, requireNumericId(), staffOnly, recordProduction);

// Bahan baku (stock_raw_items).
router.get("/", authenticate, getStockItems);
router.post("/", authenticate, adminOnly, addStockItem);
router.put("/:id", authenticate, adminOnly, requireNumericId(), updateStockItem);
router.delete("/:id", authenticate, adminOnly, requireNumericId(), deleteStockItem);
router.patch("/:id/cogs", authenticate, adminOnly, requireNumericId(), updateStockCogs);
router.patch("/:id/stock", authenticate, requireNumericId(), staffOnly, updateStockQuantity);

module.exports = router;
