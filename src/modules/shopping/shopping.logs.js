// History of the Belanja page (admins): every create, edit and delete of a
// posted purchase line, bahan baku and barang lainnya together, newest first,
// 10 a page. A deleted line or nota keeps its log (item name, toko and data
// saved in it).
const { pool } = require("../../infrastructure/database/pool");

const PAGE_SIZE = 10;
const ACTIONS = ["create", "edit", "delete"];
const SOURCES = [
  {
    source: "raw",
    logs: "history_stock_raw_purchase_item_logs",
    purchases: "history_stock_raw_purchases",
    kind: "'Bahan Baku'",
    joins: "",
  },
  {
    source: "supply",
    logs: "history_stock_supply_purchase_item_logs",
    purchases: "history_stock_supply_purchases",
    kind: "COALESCE(si.category, 'Lain-lain')",
    joins: "LEFT JOIN stock_supply_items si ON si.id = l.supply_item_id",
  },
];

const parseJson = (value) => {
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

// The rows of page `page` (newest first) and how many match.
// action: create, edit or delete; search: barang, toko or user; from / to: a
// period of days.
// The log tables are read apart and merged here: on databases whose tables
// differ in collation, a UNION of their text columns fails. Each gives its
// newest page × 10, enough for the merged page.
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const activityLogs = async ({ page, action, search, from, to } = {}) => {
  const currentPage = Math.max(Math.floor(Number(page)) || 1, 1);
  const filters = [];
  const params = [];
  if (ACTIONS.includes(action)) {
    filters.push("l.action = ?");
    params.push(action);
  }
  // from / to: days (YYYY-MM-DD, Jakarta, both included).
  if (DAY_PATTERN.test(String(from || ""))) {
    filters.push("l.created_at >= ?");
    params.push(`${from} 00:00:00`);
  }
  if (DAY_PATTERN.test(String(to || ""))) {
    filters.push("l.created_at < DATE_ADD(?, INTERVAL 1 DAY)");
    params.push(to);
  }
  const keyword = String(search || "").trim();
  if (keyword) {
    filters.push("(l.item_name LIKE ? OR p.suplier_name LIKE ? OR l.user_name LIKE ?)");
    params.push(...Array(3).fill(`%${keyword}%`));
  }
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

  const results = await Promise.all(
    SOURCES.map(async (table) => {
      const from = `FROM ${table.logs} l
        LEFT JOIN ${table.purchases} p ON p.id = l.purchase_id
        ${table.joins}
        ${where}`;
      const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total ${from}`, params);
      const [rows] = await pool.query(
        `SELECT l.id, '${table.source}' AS source, ${table.kind} AS kind, l.purchase_item_id,
                l.purchase_id, l.item_name, l.action, l.old_data, l.new_data, l.user_name,
                l.created_at, p.suplier_name AS supplier_name
         ${from}
         ORDER BY l.created_at DESC, l.id DESC
         LIMIT ?`,
        [...params, currentPage * PAGE_SIZE]
      );
      return { total: Number(total) || 0, rows };
    })
  );

  const rows = results
    .flatMap((result) => result.rows)
    .sort((first, second) => new Date(second.created_at) - new Date(first.created_at) || second.id - first.id)
    .slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return {
    logs: rows.map((row) => ({
      id: `${row.source}-${row.id}`,
      kind: row.kind,
      purchaseItemId: row.purchase_item_id,
      purchaseId: row.purchase_id,
      supplierName: row.supplier_name || "",
      itemName: row.item_name,
      action: row.action,
      oldData: parseJson(row.old_data),
      newData: parseJson(row.new_data),
      userName: row.user_name || "Admin",
      createdAt: row.created_at,
    })),
    total: results.reduce((sum, result) => sum + result.total, 0),
    page: currentPage,
    pageSize: PAGE_SIZE,
  };
};

module.exports = { activityLogs };
