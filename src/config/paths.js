const path = require("path");

const BACKEND_ROOT = path.resolve(__dirname, "..", "..");
const UPLOADS_DIR = path.join(BACKEND_ROOT, "uploads");
const MENU_UPLOAD_DIR = path.join(UPLOADS_DIR, "menu");

module.exports = { BACKEND_ROOT, MENU_UPLOAD_DIR, UPLOADS_DIR };
