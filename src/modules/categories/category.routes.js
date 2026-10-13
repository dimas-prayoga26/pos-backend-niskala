const express = require("express");
const authenticate = require("../../shared/middleware/authenticate");
const { requireRole } = require("../../shared/middleware/authorize");
const { requireNumericId } = require("../../shared/middleware/validateParams");
const {
  addCategory,
  deleteCategory,
  getCategories,
  updateCategory,
  updateCategoryPositions,
} = require("./category.controller");

const router = express.Router();
const adminOnly = requireRole("admin", "Only admin can manage categories!");

router.get("/", authenticate, getCategories);
router.post("/", authenticate, adminOnly, addCategory);
router.put("/positions", authenticate, adminOnly, updateCategoryPositions);
router.put("/:id", authenticate, adminOnly, requireNumericId(), updateCategory);
router.delete("/:id", authenticate, adminOnly, requireNumericId(), deleteCategory);

module.exports = router;
