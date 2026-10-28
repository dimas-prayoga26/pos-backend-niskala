const { pool, withTransaction } = require("../../infrastructure/database/pool");
const { refreshMenuCosts } = require("../menu/menu.costs");
const {
  areConvertible,
  convertBetweenUnits,
} = require("../../shared/utils/units");

// Traffic-light status shown on the stock dashboard.
const getStockStatus = (row) => {
  if (row.is_prepared) return "OLAHAN";
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
    isPrepared: Boolean(row.is_prepared),
    yieldQuantity: Number(row.yield_quantity || 1),
    components: [],
    status: getStockStatus(row),
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

// Components (prepared_item_recipes) of the prepared items in the list.
const attachComponents = async (stockItems) => {
  const preparedIds = stockItems.filter((item) => item.isPrepared).map((item) => item.id);
  if (!preparedIds.length) return stockItems;

  const [rows] = await pool.query(
    `SELECT pr.prepared_item_id, pr.stock_item_id, pr.quantity, pr.cost,
            si.name AS stock_item_name, si.unit, si.unit_cost
     FROM prepared_item_recipes pr
     JOIN stock_items si ON si.id = pr.stock_item_id
     WHERE pr.prepared_item_id IN (?)
     ORDER BY pr.sort_order ASC, pr.id ASC`,
    [preparedIds]
  );
  const componentsByPreparedId = new Map();
  for (const row of rows) {
    if (!componentsByPreparedId.has(row.prepared_item_id)) {
      componentsByPreparedId.set(row.prepared_item_id, []);
    }
    componentsByPreparedId.get(row.prepared_item_id).push({
      stockItemId: row.stock_item_id,
      name: row.stock_item_name,
      unit: row.unit,
      quantity: Number(row.quantity),
      unitCost: Number(row.unit_cost || 0),
      cost: Number(row.cost || 0),
    });
  }

  return stockItems.map((item) =>
    item.isPrepared ? { ...item, components: componentsByPreparedId.get(item.id) || [] } : item
  );
};

const findAll = async () => {
  const [rows] = await pool.query(
    `SELECT *
     FROM stock_items
     WHERE is_active = TRUE
     ORDER BY name ASC`
  );

  return attachComponents(rows.map(mapStockItem));
};

const findById = async (id) => {
  const [rows] = await pool.query(
    "SELECT * FROM stock_items WHERE id = ? LIMIT 1",
    [id]
  );
  if (!rows.length) return null;

  const [stockItem] = await attachComponents([mapStockItem(rows[0])]);
  return stockItem;
};

// Prepared items (bahan olahan) are made, not bought: they keep no stock or
// stock value of their own, and their unit_cost comes from their components
// divided by the yield (refreshMenuCosts). Components are raw stock items in
// their own unit. Returns the item id, or null when id is not a prepared item.
const savePrepared = async (id, { name, category, unit, yieldQuantity, components }) =>
  withTransaction(async (connection) => {
    let preparedId = id;

    if (id) {
      const [result] = await connection.query(
        `UPDATE stock_items
         SET name = ?, category = ?, unit = ?, yield_quantity = ?
         WHERE id = ? AND is_prepared = TRUE`,
        [name, category, unit, yieldQuantity, id]
      );
      if (!result.affectedRows) return null;
    } else {
      const [result] = await connection.query(
        `INSERT INTO stock_items
          (name, category, unit, stock, minimum_stock, unit_cost, stock_value, is_prepared, yield_quantity)
         VALUES (?, ?, ?, 0, 0, 0, 0, TRUE, ?)`,
        [name, category, unit, yieldQuantity]
      );
      preparedId = result.insertId;
    }

    await connection.query("DELETE FROM prepared_item_recipes WHERE prepared_item_id = ?", [
      preparedId,
    ]);
    if (components.length) {
      await connection.query(
        `INSERT INTO prepared_item_recipes (prepared_item_id, stock_item_id, quantity, sort_order)
         VALUES ?`,
        [components.map((component, index) => [preparedId, component.stockItemId, component.quantity, index + 1])]
      );
    } else {
      await connection.query("UPDATE stock_items SET unit_cost = 0 WHERE id = ?", [preparedId]);
    }

    await refreshMenuCosts(connection, { stockItemIds: [preparedId] });
    return preparedId;
  });

// Stock items by id with whether they are prepared, to validate components.
const findKinds = async (ids) => {
  if (!ids.length) return [];

  const [rows] = await pool.query(
    "SELECT id, name, is_prepared FROM stock_items WHERE id IN (?) AND is_active = TRUE",
    [ids]
  );
  return rows.map((row) => ({ id: row.id, name: row.name, isPrepared: Boolean(row.is_prepared) }));
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

// Prepared items made from the stock item; they block deleting it (ON DELETE RESTRICT).
const findPreparedItemNames = async (id) => {
  const [rows] = await pool.query(
    `SELECT DISTINCT p.name
     FROM prepared_item_recipes pr
     JOIN stock_items p ON p.id = pr.prepared_item_id
     WHERE pr.stock_item_id = ?
     ORDER BY p.name ASC`,
    [id]
  );

  return rows.map((row) => row.name);
};

module.exports = {
  create,
  findAll,
  findById,
  findKinds,
  findPreparedItemNames,
  findRecipeMenuNames,
  remove,
  savePrepared,
  update,
  updateCogs,
  updateStock,
};
