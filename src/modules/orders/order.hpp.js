// Modul 2, Penjualan & COGS. On a nota, the bahan baku lines (barang standar)
// get their HPP at the sale. The bahan setengah jadi lines (bahan olahan:
// Nasi, sambal, ...) are sold with a Pending Flag (order_item_costs.is_pending)
// at the latest cost per portion, because the real one depends on how many
// portions the kitchen got out of the day's cooking. Each cooking recorded for
// the day (Catat Masak, the Daily Prep) spreads its cost per portion (cost of
// the day's cookings / their portions) to the day's pending lines; the daily
// recap then closes the day: lines without a cooking that day keep the cost
// they were sold with (fallback), every line is locked and the notas become
// "closed". The HPP stays a snapshot on the nota (order_item_costs,
// order_items.hpp_cost): later prices never change it.
const { roundCost } = require("../../shared/utils/money");

const HPP_PENDING = "pending";
const HPP_CLOSED = "closed";

// Cost of one portion of each semi item over its cookings of a business day.
const dayCostsOf = async (connection, date, semiItemIds) => {
  const [rows] = await connection.query(
    `SELECT semi_item_id, SUM(cost) AS cost, SUM(portion_quantity) AS portions
     FROM stock_semi_item_productions
     WHERE semi_item_id IN (?) AND DATE(produced_at) = ?
     GROUP BY semi_item_id`,
    [semiItemIds, date]
  );
  return new Map(
    rows
      .filter((row) => Number(row.portions) > 0)
      .map((row) => [Number(row.semi_item_id), Number(row.cost) / Number(row.portions)])
  );
};

// Spreads the cooking cost of a business day (YYYY-MM-DD) to its pending
// lines, of some semi items or one order only. close: the day is over, so the
// lines without a cooking keep their cost (fallback), all are locked and the
// day's notas are closed. Runs in the caller's transaction. Returns per semi
// item the portions sold, the cost per portion and where it came from
// ("dapur" or "fallback"), and how many notas were closed.
const allocateBatchCosts = async (connection, { date, semiItemIds = null, orderId = null, close = false }) => {
  const filters = [
    ...(semiItemIds ? ["c.semi_item_id IN (?)"] : []),
    ...(orderId ? ["o.id = ?"] : []),
  ];
  const [lines] = await connection.query(
    `SELECT c.id, c.order_item_id, c.semi_item_id, c.stock_item_name, c.quantity, c.unit, c.unit_cost,
            oi.quantity AS sold, ss.unit_cost AS current_cost
     FROM order_item_costs c
     JOIN order_items oi ON oi.id = c.order_item_id
     JOIN orders o ON o.id = oi.order_id
     LEFT JOIN stock_semi_items ss ON ss.id = c.semi_item_id
     WHERE c.is_pending = TRUE AND DATE(o.order_date) = ?${filters.map((filter) => ` AND ${filter}`).join("")}
     ORDER BY c.id
     FOR UPDATE`,
    [date, ...(semiItemIds ? [semiItemIds] : []), ...(orderId ? [orderId] : [])]
  );

  const semiIds = [...new Set(lines.map((line) => Number(line.semi_item_id)).filter(Boolean))];
  const dayCosts = semiIds.length ? await dayCostsOf(connection, date, semiIds) : new Map();
  const items = new Map();
  for (const line of lines) {
    const dayCost = dayCosts.get(Number(line.semi_item_id));
    // Fallback: the cost it was sold with, else the item's latest one.
    const perPortion = dayCost ?? (Number(line.unit_cost) || Number(line.current_cost) || 0);
    await connection.query(
      "UPDATE order_item_costs SET unit_cost = ?, cost = ?, hpp_source = ?, is_pending = ? WHERE id = ?",
      [roundCost(perPortion), roundCost(Number(line.quantity) * perPortion), dayCost == null ? "penjualan" : "dapur", !close, line.id]
    );

    const key = line.semi_item_id || line.stock_item_name;
    const item = items.get(key) || {
      semiItemId: line.semi_item_id,
      name: line.stock_item_name,
      unit: line.unit,
      portions: 0,
      unitCost: roundCost(perPortion),
      source: dayCost == null ? "fallback" : "dapur",
    };
    item.portions = Math.round((item.portions + Number(line.quantity) * Number(line.sold)) * 100) / 100;
    items.set(key, item);
  }

  // The HPP of each order item stays the sum of its lines.
  const orderItemIds = [...new Set(lines.map((line) => line.order_item_id))];
  if (orderItemIds.length) {
    await connection.query(
      `UPDATE order_items oi
       JOIN (
         SELECT order_item_id, SUM(cost) AS hpp
         FROM order_item_costs
         WHERE order_item_id IN (?)
         GROUP BY order_item_id
       ) costs ON costs.order_item_id = oi.id
       SET oi.hpp_cost = costs.hpp
       WHERE costs.hpp > 0`,
      [orderItemIds]
    );
  }

  let closedOrders = 0;
  if (close) {
    const [result] = await connection.query(
      `UPDATE orders SET hpp_status = ?, hpp_closed_at = NOW()
       WHERE hpp_status = ? AND DATE(order_date) = ?`,
      [HPP_CLOSED, HPP_PENDING, date]
    );
    closedOrders = result.affectedRows;
  }

  return { closedOrders, items: [...items.values()] };
};

// Business day (YYYY-MM-DD) of an order or a cooking, as the database sees it.
const dayOf = async (connection, table, id, column) => {
  const [[row]] = await connection.query(
    `SELECT DATE_FORMAT(${column}, '%Y-%m-%d') AS day FROM ${table} WHERE id = ?`,
    [id]
  );
  return row?.day || null;
};

module.exports = { HPP_CLOSED, HPP_PENDING, allocateBatchCosts, dayOf };
