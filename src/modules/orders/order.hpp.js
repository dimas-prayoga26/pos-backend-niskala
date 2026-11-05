// Modul 2, Penjualan & COGS. On a nota, the bahan baku lines (barang standar)
// get their HPP at the sale. A bahan olahan line (Nasi, sambal, ...) whose
// stock covers the sale (not below 0 after it) is final at once too: the
// day's cooking cost per portion (cost of the day's cookings / their
// portions), else the stock's cost per portion. One sold short of stock
// (before the Daily Prep) gets a Pending Flag (order_item_costs.is_pending):
// the next cooking (Catat Masak) gives it the day's cost per portion, and
// settles it once the stock is back at 0 or above. The daily recap (or 00:00)
// closes the day: lines still pending keep the cost they have (fallback),
// every line is locked and the notas become "closed". The HPP stays a
// snapshot on the nota (order_item_costs, order_items.hpp_cost): later prices
// never change it.
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

// Bahan olahan (ids) whose stock covers what was sold: not below 0.
const coveredSemiIds = async (connection, semiItemIds) => {
  if (!semiItemIds.length) return [];
  const [rows] = await connection.query("SELECT id FROM stock_semi_items WHERE id IN (?) AND stock >= 0", [semiItemIds]);
  return rows.map((row) => Number(row.id));
};

// Spreads the cooking cost of a business day (YYYY-MM-DD) to its pending
// lines, of some semi items or one order only. finalize: their stock covers
// them, so the lines are settled and a nota without pending lines left is
// closed. close: the day is over, so the lines without a cooking keep their
// cost (fallback), all are locked and the day's notas are closed. Runs in the
// caller's transaction. Returns per semi item the portions sold, the cost per
// portion and where it came from ("dapur" or "fallback"), and how many notas
// were closed.
const allocateBatchCosts = async (connection, { date, semiItemIds = null, orderId = null, close = false, finalize = false }) => {
  const filters = [
    ...(semiItemIds ? ["c.semi_item_id IN (?)"] : []),
    ...(orderId ? ["o.id = ?"] : []),
  ];
  const [lines] = await connection.query(
    `SELECT c.id, c.order_item_id, c.semi_item_id, c.stock_item_name, c.quantity, c.unit, c.unit_cost,
            oi.order_id, oi.quantity AS sold, ss.unit_cost AS current_cost
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
      [roundCost(perPortion), roundCost(Number(line.quantity) * perPortion), dayCost == null ? "penjualan" : "dapur", !(close || finalize), line.id]
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
  } else if (finalize && lines.length) {
    const [result] = await connection.query(
      `UPDATE orders o SET hpp_status = ?, hpp_closed_at = NOW()
       WHERE o.id IN (?) AND o.hpp_status = ?
         AND NOT EXISTS (
           SELECT 1 FROM order_items oi
           JOIN order_item_costs c ON c.order_item_id = oi.id
           WHERE oi.order_id = o.id AND c.is_pending = TRUE
         )`,
      [HPP_CLOSED, [...new Set(lines.map((line) => line.order_id))], HPP_PENDING]
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

module.exports = { HPP_CLOSED, HPP_PENDING, allocateBatchCosts, coveredSemiIds, dayOf };
