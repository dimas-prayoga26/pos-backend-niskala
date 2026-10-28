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

const router = express.Router();
const adminOnly = requireRole("admin", "Only admin can manage stock items!");
const staffOnly = requireRole(["admin", "cashier"], "Only admin or cashier can update stock!");

router.get("/", authenticate, getStockItems);
router.post("/", authenticate, adminOnly, addStockItem);
router.put("/:id", authenticate, adminOnly, requireNumericId(), updateStockItem);
router.delete("/:id", authenticate, adminOnly, requireNumericId(), deleteStockItem);
router.patch("/:id/cogs", authenticate, adminOnly, requireNumericId(), updateStockCogs);
router.patch("/:id/stock", authenticate, requireNumericId(), staffOnly, updateStockQuantity);

module.exports = router;
