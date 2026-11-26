const express = require("express");
const authenticate = require("../../shared/middleware/authenticate");
const { requireRole } = require("../../shared/middleware/authorize");
const { requireNumericId } = require("../../shared/middleware/validateParams");
const {
  addMenuItem,
  deleteMenuItem,
  getMenuItemSales,
  getMenuItems,
  setMenuItemAvailability,
  updateMenuItem,
  uploadMenuImage,
} = require("./menu.controller");
const { uploadMenuImage: receiveImage } = require("./menu.upload");

const router = express.Router();
const adminOnly = requireRole("admin", "Only admin can manage menu items!");
// Kasir add menus and promos too (Menu → Tambah Menu / Tambah Promo) and see a
// promo's Riwayat; changing or removing one stays with admins.
const staffOnly = requireRole(["admin", "cashier"], "Only admin or cashier can add menu items!");

router.get("/", authenticate, getMenuItems);
router.post("/", authenticate, staffOnly, addMenuItem);
// The role check runs before multer so rejected uploads never touch the disk.
router.post("/upload-image", authenticate, staffOnly, receiveImage, uploadMenuImage);
router.put("/:id", authenticate, adminOnly, requireNumericId(), updateMenuItem);
// Menu → Promo card: on/off (Tersedia) and Riwayat (who bought it).
router.patch("/:id/availability", authenticate, adminOnly, requireNumericId(), setMenuItemAvailability);
router.get("/:id/sales", authenticate, staffOnly, requireNumericId(), getMenuItemSales);
router.delete("/:id", authenticate, adminOnly, requireNumericId(), deleteMenuItem);

module.exports = router;
