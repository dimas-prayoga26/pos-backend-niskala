// Bahan baku thrown away (Buang): history_stock_raw_wastes. The quantity
// leaves stock_raw_items at the exact unit cost (stock_value / stock) and is
// kept as kerugian, like the write-offs of bahan olahan
// (semi.repository). Tables: see wasteSchema.js.
const createHttpError = require("http-errors");
const { pool, withTransaction } = require("../../infrastructure/database/pool");
const { roundCost, roundCurrency } = require("../../shared/utils/money");
const { todayKey } = require("../../shared/utils/validate");
const { photoFileNames, removePhotoFiles, savePhotos, withPhotoFiles, withPhotos } = require("./wastes");

const roundStock = (value) => Math.round((Number(value) || 0) * 100) / 100;

const formatQuantity = (quantity, unit) =>
  `${Number(quantity).toLocaleString("id-ID", { maximumFractionDigits: 2 })} ${unit}`.trim();

// Returns false when the bahan baku is not found.
const recordWaste = (stockItemId, { quantity, reason, note, photos }, userId) =>
  withPhotoFiles((written) =>
    withTransaction(async (connection) => {
      const [[item]] = await connection.query(
        "SELECT * FROM stock_raw_items WHERE id = ? FOR UPDATE",
        [stockItemId]
      );
      if (!item) return false;
      if (item.is_unlimited) {
        throw createHttpError(400, `Stok ${item.name} tidak dihitung, jadi tidak bisa dibuang.`);
      }

      const stock = Number(item.stock) || 0;
      if (quantity > stock) {
        throw createHttpError(409, `Stok ${item.name} tinggal ${formatQuantity(Math.max(stock, 0), item.unit)}.`);
      }
      const value = Number(item.stock_value) || 0;
      const cost = stock > 0 && value > 0
        ? roundCurrency((value * quantity) / stock)
        : roundCurrency(quantity * Number(item.unit_cost || 0));

      await connection.query(
        "UPDATE stock_raw_items SET stock = ?, stock_value = ? WHERE id = ?",
        [roundStock(stock - quantity), Math.max(roundCurrency(value - cost), 0), item.id]
      );
      const [result] = await connection.query(
        `INSERT INTO history_stock_raw_wastes
          (stock_item_id, item_name, waste_date, quantity, unit, unit_cost, cost, reason, note, user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [item.id, item.name, todayKey(), quantity, item.unit, roundCost(cost / quantity), cost, reason, note || null, userId || null]
      );
      await savePhotos(connection, "raw", result.insertId, photos, userId, written);
      return true;
    })
  );

const mapWaste = (row) => ({
  id: row.id,
  stockItemId: row.stock_item_id,
  itemName: row.item_name,
  wasteDate: row.waste_date,
  quantity: Number(row.quantity),
  unit: row.unit,
  unitCost: Number(row.unit_cost || 0),
  cost: Number(row.cost || 0),
  reason: row.reason,
  note: row.note || "",
  userName: row.user_name || "",
  createdAt: row.created_at,
});

// Write-offs between from and to (business days, inclusive): the latest rows
// and the total kerugian per day.
const listWastes = async ({ from, to, stockItemId, limit = 100 } = {}) => {
  const conditions = [];
  const params = [];
  if (from) {
    conditions.push("w.waste_date >= ?");
    params.push(from);
  }
  if (to) {
    conditions.push("w.waste_date <= ?");
    params.push(to);
  }
  if (stockItemId) {
    conditions.push("w.stock_item_id = ?");
    params.push(stockItemId);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const [rows] = await pool.query(
    `SELECT w.*, u.name AS user_name
     FROM history_stock_raw_wastes w
     LEFT JOIN users u ON u.id = w.user_id
     ${where}
     ORDER BY w.waste_date DESC, w.id DESC
     LIMIT ?`,
    [...params, limit]
  );
  const [totals] = await pool.query(
    `SELECT w.waste_date, SUM(w.cost) AS cost, COUNT(*) AS entries
     FROM history_stock_raw_wastes w
     ${where}
     GROUP BY w.waste_date
     ORDER BY w.waste_date DESC`,
    params
  );

  return {
    wastes: await withPhotos("raw", rows.map(mapWaste)),
    dailyTotals: totals.map((row) => ({
      date: row.waste_date,
      cost: Number(row.cost || 0),
      entries: Number(row.entries),
    })),
  };
};

// Undoes the latest write-off of an item (a typo): its quantity and value go
// back to stock and its photos are removed. Returns the bahan baku id (0 when
// it was deleted), or null when the write-off is not found.
const deleteWaste = async (wasteId) => {
  const deleted = await withTransaction(async (connection) => {
    const [[waste]] = await connection.query(
      "SELECT * FROM history_stock_raw_wastes WHERE id = ? FOR UPDATE",
      [wasteId]
    );
    if (!waste) return null;

    if (waste.stock_item_id) {
      const [[latest]] = await connection.query(
        "SELECT MAX(id) AS id FROM history_stock_raw_wastes WHERE stock_item_id = ?",
        [waste.stock_item_id]
      );
      if (latest.id !== waste.id) {
        throw createHttpError(409, "Hanya catatan buang terakhir yang bisa dibatalkan.");
      }

      await connection.query(
        "UPDATE stock_raw_items SET stock = stock + ?, stock_value = stock_value + ? WHERE id = ?",
        [Number(waste.quantity), Number(waste.cost), waste.stock_item_id]
      );
    }

    const files = await photoFileNames(connection, "raw", wasteId);
    await connection.query("DELETE FROM history_stock_raw_wastes WHERE id = ?", [wasteId]);
    return { stockItemId: waste.stock_item_id || 0, files };
  });
  if (!deleted) return null;

  await removePhotoFiles(deleted.files);
  return deleted.stockItemId;
};

module.exports = { deleteWaste, listWastes, recordWaste };
