const { pool } = require("../config/database");

const getStockStatus = (row) => {
  if (Boolean(row.is_unlimited)) return "BEBAS STOK";

  const stock = Number(row.stock || 0);
  const minimumStock = Number(row.minimum_stock || 0);
  const warningLimit = minimumStock + Math.max(1, minimumStock * 0.2);

  if (stock <= minimumStock) return "HARUS ORDER";
  if (stock <= warningLimit) return "HAMPIR HABIS";
  return "AMAN";
};

const mapStockItem = (row) => {
  if (!row) return null;

  return {
    _id: row.id,
    id: row.id,
    name: row.name,
    category: row.category,
    unit: row.unit,
    stock: Number(row.stock),
    minimumStock: Number(row.minimum_stock),
    supplier: row.supplier || "",
    isUnlimited: Boolean(row.is_unlimited),
    status: getStockStatus(row),
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const findAll = async () => {
  const [rows] = await pool.query(
    `SELECT *
     FROM stock_items
     WHERE is_active = TRUE
     ORDER BY name ASC`
  );

  return rows.map(mapStockItem);
};

const findById = async (id) => {
  const [rows] = await pool.query(
    "SELECT * FROM stock_items WHERE id = ? LIMIT 1",
    [id]
  );

  return mapStockItem(rows[0]);
};

const create = async ({
  name,
  category,
  unit,
  stock = 0,
  minimumStock = 0,
  supplier,
  isUnlimited = false,
}) => {
  const [result] = await pool.query(
    `INSERT INTO stock_items
      (name, category, unit, stock, minimum_stock, supplier, is_unlimited)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [name, category, unit, stock, minimumStock, supplier || null, isUnlimited ? 1 : 0]
  );

  return findById(result.insertId);
};

const update = async (
  id,
  { name, category, unit, stock = 0, minimumStock = 0, supplier, isUnlimited = false }
) => {
  const [result] = await pool.query(
    `UPDATE stock_items
     SET name = ?, category = ?, unit = ?, stock = ?, minimum_stock = ?, supplier = ?, is_unlimited = ?
     WHERE id = ?`,
    [name, category, unit, stock, minimumStock, supplier || null, isUnlimited ? 1 : 0, id]
  );

  if (!result.affectedRows) return null;

  return findById(id);
};

const updateStock = async (id, stock) => {
  const [result] = await pool.query(
    "UPDATE stock_items SET stock = ? WHERE id = ?",
    [stock, id]
  );

  if (!result.affectedRows) return null;

  return findById(id);
};

const remove = async (id) => {
  const [result] = await pool.query("DELETE FROM stock_items WHERE id = ?", [
    id,
  ]);

  return result.affectedRows > 0;
};

module.exports = {
  create,
  findAll,
  findById,
  remove,
  update,
  updateStock,
};
