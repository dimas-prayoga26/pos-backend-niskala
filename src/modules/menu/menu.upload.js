const fs = require("fs");
const multer = require("multer");
const path = require("path");
const { MENU_UPLOAD_DIR } = require("../../config/paths");

const MAX_IMAGE_SIZE_BYTES = 3 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png"];
const ALLOWED_EXTENSIONS = [".jpg", ".jpeg", ".png"];

fs.mkdirSync(MENU_UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, MENU_UPLOAD_DIR),
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

const uploadMenuImage = multer({
  storage,
  limits: { fileSize: MAX_IMAGE_SIZE_BYTES },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();

    if (ALLOWED_TYPES.includes(file.mimetype) && ALLOWED_EXTENSIONS.includes(ext)) {
      cb(null, true);
      return;
    }

    cb(new Error("Only jpg, jpeg, and png images are allowed!"));
  },
}).single("image");

module.exports = { uploadMenuImage };
