const express = require("express");
const authenticate = require("../../shared/middleware/authenticate");
const { requireRole } = require("../../shared/middleware/authorize");
const { requireNumericId } = require("../../shared/middleware/validateParams");
const {
  addMenuItem,
  deleteMenuItem,
  getMenuItems,
  updateMenuItem,
  uploadMenuImage,
} = require("./menu.controller");
const { uploadMenuImage: receiveImage } = require("./menu.upload");

const router = express.Router();
const adminOnly = requireRole("admin", "Only admin can manage menu items!");

router.get("/", authenticate, getMenuItems);
router.post("/", authenticate, adminOnly, addMenuItem);
// The role check runs before multer so rejected uploads never touch the disk.
router.post("/upload-image", authenticate, adminOnly, receiveImage, uploadMenuImage);
router.put("/:id", authenticate, adminOnly, requireNumericId(), updateMenuItem);
router.delete("/:id", authenticate, adminOnly, requireNumericId(), deleteMenuItem);

module.exports = router;
