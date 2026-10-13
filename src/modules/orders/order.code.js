// Monthly order codes (YYMM-NNNN). A MySQL named lock per month serializes
// code allocation; it must be released after the order transaction commits.
const createHttpError = require("http-errors");
const {
  MONTHLY_ORDER_CODE_PATTERN,
  formatMonthlyOrderCode,
} = require("../../shared/utils/orderCode");

const acquireMonthlyOrderCodeLock = async (connection, orderDate = null) => {
  const [periodRows] = await connection.query(
    "SELECT DATE_FORMAT(COALESCE(?, CURRENT_TIMESTAMP), '%Y-%m') AS period_key",
    [orderDate]
  );
  const lockName = `orders:monthly-code:${periodRows[0]?.period_key || "current"}`;
  const [lockRows] = await connection.query("SELECT GET_LOCK(?, 10) AS locked", [
    lockName,
  ]);

  if (Number(lockRows[0]?.locked) !== 1) {
    throw createHttpError(503, "Gagal membuat nomor order. Silakan coba lagi.");
  }

  return lockName;
};

const releaseMonthlyOrderCodeLock = async (connection, lockName) => {
  if (!lockName) return;

  try {
    await connection.query("SELECT RELEASE_LOCK(?)", [lockName]);
  } catch (error) {
    // The connection closing also releases MySQL named locks.
  }
};

const createMonthlyOrderCode = async (connection, orderId) => {
  const [periodRows] = await connection.query(
    `SELECT
       DATE_FORMAT(order_date, '%m') AS order_month,
       DATE_FORMAT(order_date, '%y') AS order_year
     FROM orders
     WHERE id = ?
     LIMIT 1`,
    [orderId]
  );
  const period = periodRows[0];

  if (!period) {
    throw new Error("Order tidak ditemukan saat membuat nomor order.");
  }

  const codePrefix = `${period.order_year}${period.order_month}`;
  const [sequenceRows] = await connection.query(
    `SELECT MAX(CAST(SUBSTRING(order_code, 6, 4) AS UNSIGNED)) AS max_sequence
     FROM orders
     WHERE order_code REGEXP '${MONTHLY_ORDER_CODE_PATTERN}'
       AND SUBSTRING(order_code, 1, 4) = ?
       AND id <> ?`,
    [codePrefix, orderId]
  );
  const nextSequence = Number(sequenceRows[0]?.max_sequence || 0) + 1;

  return formatMonthlyOrderCode({
    sequence: nextSequence,
    month: period.order_month,
    year: period.order_year,
  });
};

module.exports = {
  acquireMonthlyOrderCodeLock,
  createMonthlyOrderCode,
  releaseMonthlyOrderCodeLock,
};
