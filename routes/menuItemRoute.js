const express = require("express");
const fs = require("fs");
const multer = require("multer");
const path = require("path");
const {
  addMenuItem,
  deleteMenuItem,
  getMenuItems,
  uploadMenuImage,
  updateMenuItem,
} = require("../controllers/menuItemController");
const { isVerifiedUser } = require("../middlewares/tokenVerification");

const router = express.Router();
const uploadDir = path.join(__dirname, "..", "uploads", "menu");

fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeBaseName = path
      .basename(file.originalname, ext)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);

    cb(null, `${Date.now()}-${safeBaseName || "menu"}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowedTypes = ["image/jpeg", "image/png"];
    const allowedExts = [".jpg", ".jpeg", ".png"];
    const ext = path.extname(file.originalname).toLowerCase();

    if (allowedTypes.includes(file.mimetype) && allowedExts.includes(ext)) {
      cb(null, true);
      return;
    }

    cb(new Error("Only jpg, jpeg, and png images are allowed!"));
  },
});

router.route("/").get(isVerifiedUser, getMenuItems);
router.route("/").post(isVerifiedUser, addMenuItem);
router
  .route("/upload-image")
  .post(isVerifiedUser, upload.single("image"), uploadMenuImage);
router.route("/:id").put(isVerifiedUser, updateMenuItem);
router.route("/:id").delete(isVerifiedUser, deleteMenuItem);

module.exports = router;
