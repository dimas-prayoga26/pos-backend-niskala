const path = require("path");

const BACKEND_ROOT = path.resolve(__dirname, "..", "..");
const UPLOADS_DIR = path.join(BACKEND_ROOT, "uploads");
const MENU_UPLOAD_DIR = path.join(UPLOADS_DIR, "menu");
// Private files: not under UPLOADS_DIR, so express.static never serves them.
const STORAGE_DIR = path.join(BACKEND_ROOT, "storage");
const PURCHASE_RECEIPT_DIR = path.join(STORAGE_DIR, "purchase-receipts");

module.exports = { BACKEND_ROOT, MENU_UPLOAD_DIR, PURCHASE_RECEIPT_DIR, STORAGE_DIR, UPLOADS_DIR };
