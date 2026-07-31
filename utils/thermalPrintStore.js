const crypto = require("crypto");

const THERMAL_PRINT_TTL_MS = 5 * 60 * 1000;
const MAX_THERMAL_PRINT_ITEMS = 200;
const thermalPrintJobs = new Map();

const cleanupExpiredThermalPrintJobs = () => {
  const now = Date.now();

  for (const [token, job] of thermalPrintJobs.entries()) {
    if (job.expiresAt <= now) {
      thermalPrintJobs.delete(token);
    }
  }
};

const createThermalPrintJob = ({ orderId, payload, userId }) => {
  cleanupExpiredThermalPrintJobs();

  if (!Array.isArray(payload) || payload.length === 0) {
    const error = new Error("Thermal print payload is required.");
    error.statusCode = 400;
    throw error;
  }

  if (payload.length > MAX_THERMAL_PRINT_ITEMS) {
    const error = new Error("Thermal print payload is too large.");
    error.statusCode = 413;
    throw error;
  }

  const token = crypto.randomBytes(32).toString("base64url");

  thermalPrintJobs.set(token, {
    orderId: Number(orderId),
    payload,
    userId,
    expiresAt: Date.now() + THERMAL_PRINT_TTL_MS,
  });

  return token;
};

const getThermalPrintJob = ({ orderId, token }) => {
  cleanupExpiredThermalPrintJobs();

  const job = thermalPrintJobs.get(token);

  if (!job || job.orderId !== Number(orderId)) {
    return null;
  }

  return job;
};

const toBluetoothPrintResponse = (payload) =>
  payload.reduce((response, item, index) => {
    response[index] = item;
    return response;
  }, {});

module.exports = {
  THERMAL_PRINT_TTL_MS,
  createThermalPrintJob,
  getThermalPrintJob,
  toBluetoothPrintResponse,
};
