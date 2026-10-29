const createError = require("http-errors");
const multer = require("multer");

// The app shrinks camera photos before sending them, so 5 MB is plenty.
const MAX_RECEIPT_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_RECEIPTS_PER_UPLOAD = 5;

// Kept in memory: shopping.attachments checks the bytes before writing them.
const receive = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_RECEIPT_SIZE_BYTES, files: MAX_RECEIPTS_PER_UPLOAD, fields: 5 },
}).array("files", MAX_RECEIPTS_PER_UPLOAD);

const MESSAGES = {
  LIMIT_FILE_SIZE: "Ukuran foto maksimal 5 MB.",
  LIMIT_FILE_COUNT: `Maksimal ${MAX_RECEIPTS_PER_UPLOAD} foto sekali unggah.`,
  LIMIT_UNEXPECTED_FILE: `Maksimal ${MAX_RECEIPTS_PER_UPLOAD} foto sekali unggah.`,
};

const receivePurchaseReceipts = (req, res, next) =>
  receive(req, res, (error) => {
    if (error instanceof multer.MulterError) {
      return next(createError(400, MESSAGES[error.code] || "Upload foto gagal."));
    }
    return next(error);
  });

module.exports = { receivePurchaseReceipts };
