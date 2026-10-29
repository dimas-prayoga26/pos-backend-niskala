// Perlengkapan (stock_supply_items): peralatan, operasional and promosi items.
// Stocked like bahan baku (stock.repository) but never part of a recipe.
// Belanja perlengkapan (shopping.supply) raises their stock.
const { pool, withTransaction } = require("../../infrastructure/database/pool");
const { roundCost } = require("../../shared/utils/money");
const { areConvertible, convertBetweenUnits } = require("../../shared/utils/units");
const { RESCALED_STOCK_VALUE, getStockStatus } = require("./stock.repository");

const SUPPLY_CATEGORIES = ["Peralatan", "Operasional", "Promosi"];

const mapSupplyItem = (row) => {
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
    "SELECT * FROM stock_supply_items WHERE is_active = TRUE ORDER BY name ASC"
  );
  return rows.map(mapSupplyItem);
};

const findById = async (id) => {
  const [rows] = await pool.query("SELECT * FROM stock_supply_items WHERE id = ? LIMIT 1", [id]);
  return mapSupplyItem(rows[0]);
};

// A name is either bahan baku or perlengkapan, so the purchase form never
// offers the same name under both Jenis Belanja.
const isSupplyItemName = async (name, db = pool) => {
  const [rows] = await db.query("SELECT id FROM stock_supply_items WHERE name = ? LIMIT 1", [name]);
  return rows.length > 0;
};
const isRawItemName = async (name, db = pool) => {
  const [rows] = await db.query("SELECT id FROM stock_raw_items WHERE name = ? LIMIT 1", [name]);
  return rows.length > 0;
};

// The stock starts at 0 unless given; its value comes from belanja.
const create = async ({ name, category, unit, stock = 0, minimumStock = 0, supplier, isUnlimited = false }) => {
  const [result] = await pool.query(
    `INSERT INTO stock_supply_items
      (name, category, unit, stock, minimum_stock, unit_cost, stock_value, supplier, is_unlimited)
     VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)`,
    [name, category, unit, stock, minimumStock, supplier || null, isUnlimited ? 1 : 0]
  );
  return findById(result.insertId);
};

// Switching between convertible units (e.g. gr -> kg) converts the stock and
// keeps its value; other unit changes keep the number as it is.
const update = async (id, { name, category, unit, minimumStock = 0, supplier, isUnlimited = false }) => {
  const updated = await withTransaction(async (connection) => {
    const [[current]] = await connection.query(
      "SELECT unit, stock, stock_value FROM stock_supply_items WHERE id = ? FOR UPDATE",
      [id]
    );
    if (!current) return false;

    const fromUnit = String(current.unit || "").trim().toLowerCase();
    const toUnit = String(unit || "").trim().toLowerCase();
    let stock = Number(current.stock || 0);
    if (fromUnit && fromUnit !== toUnit && areConvertible(fromUnit, toUnit)) {
      stock = Math.round(convertBetweenUnits(stock, fromUnit, toUnit) * 100) / 100;
    }
    const unitCost = stock > 0 ? roundCost(Number(current.stock_value || 0) / stock) : 0;

    await connection.query(
      `UPDATE stock_supply_items
       SET name = ?, category = ?, unit = ?, stock = ?, unit_cost = ?,
           minimum_stock = ?, supplier = ?, is_unlimited = ?
       WHERE id = ?`,
      [name, category, unit, stock, unitCost, minimumStock, supplier || null, isUnlimited ? 1 : 0, id]
    );
    return true;
  });

  return updated ? findById(id) : null;
};

// Manual count ("Sesuaikan"): revalues stock_value at the exact unit cost.
const updateStock = async (id, stock) => {
  const [result] = await pool.query(
    `UPDATE stock_supply_items SET stock_value = ${RESCALED_STOCK_VALUE}, stock = ? WHERE id = ?`,
    [stock, stock, stock, id]
  );
  if (!result.affectedRows) return null;
  return findById(id);
};

// Purchase history keeps item_name, so deleting only unlinks it (SET NULL).
const remove = async (id) => {
  const [result] = await pool.query("DELETE FROM stock_supply_items WHERE id = ?", [id]);
  return result.affectedRows > 0;
};

module.exports = {
  SUPPLY_CATEGORIES,
  create,
  findAll,
  findById,
  isRawItemName,
  isSupplyItemName,
  remove,
  update,
  updateStock,
};
