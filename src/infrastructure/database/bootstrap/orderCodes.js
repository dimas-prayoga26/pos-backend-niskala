const { pool } = require("../pool");
const {
  MONTHLY_ORDER_CODE_PATTERN: monthlyOrderCodePattern,
  formatMonthlyOrderCode,
} = require("../../../shared/utils/orderCode");

const backfillMonthlyOrderCodes = async () => {
  const [summaryRows] = await pool.query(`
    SELECT
      SUM(CASE WHEN order_code REGEXP '${monthlyOrderCodePattern}' THEN 1 ELSE 0 END) AS valid_count,
      SUM(CASE WHEN order_code IS NULL OR order_code = '' OR order_code NOT REGEXP '${monthlyOrderCodePattern}' THEN 1 ELSE 0 END) AS invalid_count
    FROM orders
  `);
  const summary = summaryRows[0] || {};
  const invalidCount = Number(summary.invalid_count || 0);

  if (!invalidCount) return;

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const hasMonthlyCodes = Number(summary.valid_count || 0) > 0;

    if (!hasMonthlyCodes) {
      await connection.query("UPDATE orders SET order_code = NULL");

      const [orders] = await connection.query(`
        SELECT
          id,
          DATE_FORMAT(order_date, '%m') AS order_month,
          DATE_FORMAT(order_date, '%y') AS order_year
        FROM orders
        ORDER BY order_date ASC, id ASC
      `);
      const counters = new Map();

      for (const order of orders) {
        const periodKey = `${order.order_year}${order.order_month}`;
        const sequence = (counters.get(periodKey) || 0) + 1;
        counters.set(periodKey, sequence);

        await connection.query("UPDATE orders SET order_code = ? WHERE id = ?", [
          formatMonthlyOrderCode({
            sequence,
            month: order.order_month,
            year: order.order_year,
          }),
          order.id,
        ]);
      }
    } else {
      await connection.query(`
        UPDATE orders
        SET order_code = NULL
        WHERE order_code IS NULL
           OR order_code = ''
           OR order_code NOT REGEXP '${monthlyOrderCodePattern}'
      `);

      const [sequenceRows] = await connection.query(`
        SELECT
          SUBSTRING(order_code, 1, 4) AS period_key,
          MAX(CAST(SUBSTRING(order_code, 6, 4) AS UNSIGNED)) AS max_sequence
        FROM orders
        WHERE order_code REGEXP '${monthlyOrderCodePattern}'
        GROUP BY SUBSTRING(order_code, 1, 4)
      `);
      const counters = new Map(
        sequenceRows.map((row) => [
          row.period_key,
          Number(row.max_sequence || 0),
        ])
      );
      const [orders] = await connection.query(`
        SELECT
          id,
          DATE_FORMAT(order_date, '%m') AS order_month,
          DATE_FORMAT(order_date, '%y') AS order_year
        FROM orders
        WHERE order_code IS NULL OR order_code = ''
        ORDER BY order_date ASC, id ASC
      `);

      for (const order of orders) {
        const periodKey = `${order.order_year}${order.order_month}`;
        const sequence = (counters.get(periodKey) || 0) + 1;
        counters.set(periodKey, sequence);

        await connection.query("UPDATE orders SET order_code = ? WHERE id = ?", [
          formatMonthlyOrderCode({
            sequence,
            month: order.order_month,
            year: order.order_year,
          }),
          order.id,
        ]);
      }
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

module.exports = { backfillMonthlyOrderCodes };
