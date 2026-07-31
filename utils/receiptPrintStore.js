const crypto = require("crypto");

const RECEIPT_PRINT_TTL_MS = 5 * 60 * 1000;
const MAX_RECEIPT_HTML_LENGTH = 256 * 1024;
const receiptPrintJobs = new Map();

const cleanupExpiredReceiptPrintJobs = () => {
  const now = Date.now();

  for (const [token, job] of receiptPrintJobs.entries()) {
    if (job.expiresAt <= now) {
      receiptPrintJobs.delete(token);
    }
  }
};

const createReceiptPrintJob = ({ orderId, documentHtml, userId }) => {
  cleanupExpiredReceiptPrintJobs();

  if (typeof documentHtml !== "string" || !documentHtml.trim()) {
    const error = new Error("Receipt HTML is required.");
    error.statusCode = 400;
    throw error;
  }

  if (documentHtml.length > MAX_RECEIPT_HTML_LENGTH) {
    const error = new Error("Receipt HTML is too large.");
    error.statusCode = 413;
    throw error;
  }

  const token = crypto.randomBytes(32).toString("base64url");

  receiptPrintJobs.set(token, {
    orderId: Number(orderId),
    documentHtml,
    userId,
    expiresAt: Date.now() + RECEIPT_PRINT_TTL_MS,
  });

  return token;
};

const consumeReceiptPrintJob = ({ orderId, token }) => {
  cleanupExpiredReceiptPrintJobs();

  const job = receiptPrintJobs.get(token);

  if (!job || job.orderId !== Number(orderId)) {
    return null;
  }

  return job;
};

module.exports = {
  RECEIPT_PRINT_TTL_MS,
  createReceiptPrintJob,
  consumeReceiptPrintJob,
};
