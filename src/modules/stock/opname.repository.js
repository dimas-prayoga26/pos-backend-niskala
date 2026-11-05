// Stock Opname (Modul 3): a physical count of bahan baku (kind "raw", Bahan
// Resep only) or bahan olahan ("semi") sets each counted stock to the count. The selisih
// (system - actual) leaves stock_value at the exact unit cost (stock_value /
// stock, else the latest unit cost) and is kept as Kehilangan Persediaan; a
// higher count (selisih lebih) adds its value back and lowers it. A count
// equal to the system stock keeps no row. Tables: see opnameSchema.js.
const createHttpError = require("http-errors");
const { pool, withTransaction } = require("../../infrastructure/database/pool");
const { roundCost, roundCurrency } = require("../../shared/utils/money");
const { todayKey } = require("../../shared/utils/validate");

const KINDS = {
  raw: { items: "stock_raw_items", opnames: "history_stock_raw_opnames", itemColumn: "stock_item_id" },
  semi: { items: "stock_semi_items", opnames: "history_stock_semi_opnames", itemColumn: "semi_item_id" },
};

const roundStock = (value) => Math.round((Number(value) || 0) * 100) / 100;

// Stock value after the count: the share of the counted stock, or, when the
// system stock was 0 or below (sold before cooking), the count at the latest
// unit cost.
const valueAfterCount = (item, actualStock) => {
  const stock = Number(item.stock) || 0;
  const value = Number(item.stock_value) || 0;
  const unitCost = stock > 0 && value > 0 ? value / stock : Number(item.unit_cost) || 0;
  const nextValue = stock > 0
    ? Math.max(roundCurrency(value - (stock - actualStock) * unitCost), 0)
    : roundCurrency(actualStock * unitCost);

  return { unitCost, nextValue, cost: roundCurrency(value - nextValue) };
};

// counts: [{ itemId, actualStock }] of one kind. Returns the bahan whose
// stock changed ({ itemId, itemName, systemStock, actualStock, difference,
// unit, cost }) and their total cost.
const recordOpname = (kindKey, { counts, note }, userId) =>
  withTransaction(async (connection) => {
    const kind = KINDS[kindKey];
    const [items] = await connection.query(
      `SELECT * FROM ${kind.items} WHERE id IN (?) AND is_active = TRUE ORDER BY id FOR UPDATE`,
      [counts.map((count) => count.itemId)]
    );
    const itemById = new Map(items.map((item) => [item.id, item]));
    if (counts.some((count) => !itemById.has(count.itemId))) {
      throw createHttpError(404, "Ada bahan yang tidak ditemukan. Muat ulang daftar stok.");
    }
    const unlimited = items.filter((item) => item.is_unlimited);
    if (unlimited.length) {
      throw createHttpError(
        400,
        `Stok ${unlimited.map((item) => item.name).join(", ")} tidak dihitung (Bebas Stok), jadi tidak ikut stock opname.`
      );
    }
    // Bahan baku: Bahan Resep only (bahan olahan have no such flag).
    const notRecipe = kindKey === "raw" ? items.filter((item) => !Number(item.is_recipe_ingredient)) : [];
    if (notRecipe.length) {
      throw createHttpError(
        400,
        `${notRecipe.map((item) => item.name).join(", ")} bukan Bahan Resep, jadi tidak ikut stock opname.`
      );
    }

    const lines = [];
    for (const { itemId, actualStock } of counts) {
      const item = itemById.get(itemId);
      const systemStock = roundStock(item.stock);
      const difference = roundStock(systemStock - actualStock);
      if (difference === 0) continue;

      const { unitCost, nextValue, cost } = valueAfterCount(item, actualStock);
      await connection.query(`UPDATE ${kind.items} SET stock = ?, stock_value = ? WHERE id = ?`, [
        actualStock,
        nextValue,
        item.id,
      ]);
      await connection.query(
        `INSERT INTO ${kind.opnames}
          (${kind.itemColumn}, item_name, opname_date, system_stock, actual_stock, difference,
           unit, unit_cost, cost, note, user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          item.id,
          item.name,
          todayKey(),
          systemStock,
          actualStock,
          difference,
          item.unit,
          roundCost(unitCost),
          cost,
          note || null,
          userId || null,
        ]
      );
      lines.push({ itemId: item.id, itemName: item.name, systemStock, actualStock, difference, unit: item.unit, cost });
    }

    return {
      lines,
      totalCost: roundCurrency(lines.reduce((total, line) => total + line.cost, 0)),
    };
  });

// A stock set by hand (PATCH .../stock) is a count like any other: its
// selisih is Kehilangan Persediaan, never a silent change nor Biaya Wastage.
const setCountedStock = (kindKey, itemId, stock, userId) =>
  recordOpname(kindKey, { counts: [{ itemId, actualStock: roundStock(stock) }], note: "Ubah stok" }, userId);

const mapOpname = (kindKey) => (row) => ({
  id: row.id,
  kind: kindKey,
  itemId: row[KINDS[kindKey].itemColumn],
  itemName: row.item_name,
  opnameDate: row.opname_date,
  systemStock: Number(row.system_stock),
  actualStock: Number(row.actual_stock),
  difference: Number(row.difference),
  unit: row.unit,
  unitCost: Number(row.unit_cost || 0),
  cost: Number(row.cost || 0),
  note: row.note || "",
  userName: row.user_name || "",
  createdAt: row.created_at,
});

// Counts of one kind between from and to (business days, inclusive): the
// latest rows and the Kehilangan Persediaan per day.
const listOpnames = async (kindKey, { from, to, limit = 100 } = {}) => {
  const kind = KINDS[kindKey];
  const conditions = [];
  const params = [];
  if (from) {
    conditions.push("o.opname_date >= ?");
    params.push(from);
  }
  if (to) {
    conditions.push("o.opname_date <= ?");
    params.push(to);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const [rows] = await pool.query(
    `SELECT o.*, u.name AS user_name
     FROM ${kind.opnames} o
     LEFT JOIN users u ON u.id = o.user_id
     ${where}
     ORDER BY o.opname_date DESC, o.id DESC
     LIMIT ?`,
    [...params, limit]
  );
  const [totals] = await pool.query(
    `SELECT o.opname_date, SUM(o.cost) AS cost, COUNT(*) AS entries
     FROM ${kind.opnames} o
     ${where}
     GROUP BY o.opname_date
     ORDER BY o.opname_date DESC`,
    params
  );

  return {
    opnames: rows.map(mapOpname(kindKey)),
    dailyTotals: totals.map((row) => ({
      date: row.opname_date,
      cost: Number(row.cost || 0),
      entries: Number(row.entries),
    })),
  };
};

// What orders took from each bahan of one kind (recipe quantity per portion,
// frozen in order_item_costs, x portions sold) on the current business day,
// after the bahan's last count that day: the Terpakai of the Stock Opname
// form. Deleted orders gave theirs back, so they are gone from it too.
const listOrderUsage = async (kindKey) => {
  const kind = KINDS[kindKey];
  const [rows] = await pool.query(
    `SELECT c.${kind.itemColumn} AS item_id, SUM(c.quantity * oi.quantity) AS quantity
     FROM order_item_costs c
     JOIN order_items oi ON oi.id = c.order_item_id
     LEFT JOIN (
       SELECT ${kind.itemColumn} AS item_id, MAX(created_at) AS counted_at
       FROM ${kind.opnames}
       WHERE created_at >= CURRENT_DATE()
       GROUP BY ${kind.itemColumn}
     ) counted ON counted.item_id = c.${kind.itemColumn}
     WHERE c.${kind.itemColumn} IS NOT NULL
       AND oi.created_at >= COALESCE(counted.counted_at, CURRENT_DATE())
     GROUP BY c.${kind.itemColumn}
     ORDER BY c.${kind.itemColumn}`
  );

  return rows
    .map((row) => ({ itemId: row.item_id, quantity: roundStock(row.quantity) }))
    .filter((row) => row.quantity > 0);
};

// Undoes the latest count of an item (a typo): its selisih and value go back
// to stock. Returns the item id (0 when it was deleted), or null when the
// count is not found.
const deleteOpname = (kindKey, opnameId) =>
  withTransaction(async (connection) => {
    const kind = KINDS[kindKey];
    const [[opname]] = await connection.query(`SELECT * FROM ${kind.opnames} WHERE id = ? FOR UPDATE`, [opnameId]);
    if (!opname) return null;

    const itemId = opname[kind.itemColumn];
    if (itemId) {
      const [[latest]] = await connection.query(
        `SELECT MAX(id) AS id FROM ${kind.opnames} WHERE ${kind.itemColumn} = ?`,
        [itemId]
      );
      if (latest.id !== opname.id) {
        throw createHttpError(409, "Hanya stock opname terakhir bahan ini yang bisa dibatalkan.");
      }

      await connection.query(
        `UPDATE ${kind.items} SET stock = stock + ?, stock_value = GREATEST(stock_value + ?, 0) WHERE id = ?`,
        [Number(opname.difference), Number(opname.cost), itemId]
      );
    }

    await connection.query(`DELETE FROM ${kind.opnames} WHERE id = ?`, [opnameId]);
    return itemId || 0;
  });

module.exports = { KINDS, deleteOpname, listOpnames, listOrderUsage, recordOpname, setCountedStock };
