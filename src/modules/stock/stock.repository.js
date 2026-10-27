const { pool, withTransaction } = require("../../infrastructure/database/pool");
const { refreshMenuCosts } = require("../menu/menu.costs");
const {
  areConvertible,
  convertBetweenUnits,
} = require("../../shared/utils/units");

// Traffic-light status shown on the stock dashboard.
const getStockStatus = (row) => {
  if (row.is_unlimited) return "BEBAS STOK";

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
    averageCost: Number(row.unit_cost || 0),
    stockValue: Number(row.stock_value || 0),
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
      (name, category, unit, stock, minimum_stock, unit_cost, stock_value, supplier, is_unlimited)
     VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)`,
    [name, category, unit, stock, minimumStock, supplier || null, isUnlimited ? 1 : 0]
  );

  return findById(result.insertId);
};

// stock_value for a new stock quantity at the exact unit cost (stock_value /
// stock) instead of the whole-rupiah unit_cost, so editing stock does not
// shift the asset value. It reads the old `stock`, so it must come before the
// `stock` assignment (MySQL applies SET assignments left to right). Takes the
// new stock twice.
const RESCALED_STOCK_VALUE = `CASE
  WHEN stock > 0 AND stock_value > 0 THEN ROUND(stock_value * ? / stock, 2)
  ELSE ROUND(? * unit_cost, 2)
END`;

// Recipe quantities are stored in the stock item's unit, so switching between
// convertible units (e.g. gr -> kg) rescales them; other unit changes leave them.
const update = async (
  id,
  { name, category, unit, stock = 0, minimumStock = 0, supplier, isUnlimited = false }
) => {
  const updated = await withTransaction(async (connection) => {
    const [[current]] = await connection.query(
      "SELECT unit FROM stock_items WHERE id = ? FOR UPDATE",
      [id]
    );
    if (!current) return false;

    await connection.query(
      `UPDATE stock_items
       SET name = ?,
           category = ?,
           unit = ?,
           stock_value = ${RESCALED_STOCK_VALUE},
           stock = ?,
           minimum_stock = ?,
           supplier = ?,
           is_unlimited = ?
       WHERE id = ?`,
      [name, category, unit, stock, stock, stock, minimumStock, supplier || null, isUnlimited ? 1 : 0, id]
    );

    const fromUnit = String(current.unit || "").trim().toLowerCase();
    const toUnit = String(unit || "").trim().toLowerCase();
    if (fromUnit !== toUnit && areConvertible(fromUnit, toUnit)) {
      await connection.query(
        "UPDATE recipes SET quantity = ROUND(quantity * ?, 4) WHERE stock_item_id = ?",
        [convertBetweenUnits(1, fromUnit, toUnit), id]
      );
      await refreshMenuCosts(connection, { stockItemIds: [id] });
    }

    return true;
  });

  return updated ? findById(id) : null;
};

const updateStock = async (id, stock) => {
  const [result] = await pool.query(
    `UPDATE stock_items SET stock_value = ${RESCALED_STOCK_VALUE}, stock = ? WHERE id = ?`,
    [stock, stock, stock, id]
  );

  if (!result.affectedRows) return null;

  return findById(id);
};

const updateCogs = async (id, { averageCost = 0, supplier }) => {
  const updated = await withTransaction(async (connection) => {
    const [result] = await connection.query(
      `UPDATE stock_items
       SET unit_cost = ROUND(?),
           stock_value = ROUND(GREATEST(stock, 0) * ?, 2),
           supplier = COALESCE(NULLIF(?, ''), supplier)
       WHERE id = ?`,
      [averageCost, averageCost, supplier || "", id]
    );
    if (!result.affectedRows) return false;

    await refreshMenuCosts(connection, { stockItemIds: [id] });
    return true;
  });

  return updated ? findById(id) : null;
};

const remove = async (id) => {
  const [result] = await pool.query("DELETE FROM stock_items WHERE id = ?", [
    id,
  ]);

  return result.affectedRows > 0;
};

// Menus whose recipe uses the stock item; recipes block deleting it (ON DELETE RESTRICT).
const findRecipeMenuNames = async (id) => {
  const [rows] = await pool.query(
    `SELECT DISTINCT mi.name
     FROM recipes r
     JOIN menu_items mi ON mi.id = r.menu_item_id
     WHERE r.stock_item_id = ?
     ORDER BY mi.name ASC`,
    [id]
  );

  return rows.map((row) => row.name);
};

module.exports = {
  create,
  findAll,
  findRecipeMenuNames,
  remove,
  update,
  updateCogs,
  updateStock,
};
