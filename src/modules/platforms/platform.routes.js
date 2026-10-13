const express = require("express");
const authenticate = require("../../shared/middleware/authenticate");
const { requireRole } = require("../../shared/middleware/authorize");
const { requireNumericId } = require("../../shared/middleware/validateParams");
const {
  addOrderPlatform,
  deleteOrderPlatform,
  getOrderPlatforms,
  updateOrderPlatform,
} = require("./platform.controller");

const router = express.Router();
const adminOnly = requireRole("admin", "Only admin can manage order platforms!");

router.get("/", authenticate, getOrderPlatforms);
router.post("/", authenticate, adminOnly, addOrderPlatform);
router.put("/:id", authenticate, adminOnly, requireNumericId(), updateOrderPlatform);
router.delete("/:id", authenticate, adminOnly, requireNumericId(), deleteOrderPlatform);

module.exports = router;
