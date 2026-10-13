// Orders on a date with a daily recap (daily_recaps, owned by recaps) are closed.
const createHttpError = require("http-errors");

const createRecapLockedError = (
  message = "Pesanan sudah masuk rekap harian dan tidak bisa diubah."
) => createHttpError(409, message);

const assertNoDailyRecapForDate = async (
  connection,
  dateExpression,
  params = [],
  message
) => {
  const [rows] = await connection.query(
    `SELECT dr.id
     FROM daily_recaps dr
     WHERE dr.recap_date = DATE(${dateExpression})
     LIMIT 1`,
    params
  );

  if (rows.length) {
    throw createRecapLockedError(message);
  }
};

const assertOrderIsNotRecapped = async (connection, orderId) => {
  const [rows] = await connection.query(
    `SELECT dr.id
     FROM orders o
     JOIN daily_recaps dr ON dr.recap_date = DATE(o.order_date)
     WHERE o.id = ?
     LIMIT 1`,
    [orderId]
  );

  if (rows.length) {
    throw createRecapLockedError();
  }
};

module.exports = { assertNoDailyRecapForDate, assertOrderIsNotRecapped };
