// Bahan setengah jadi (stock_semi_items, e.g. Nasi from Beras): composition,
// cooking ("Catat Masak") and its history. Tables: see semiItemsSchema.js.
//
// Cooking moves stock like a purchase of the semi item paid with raw items:
// the raw items (stock_raw_items) lose batch x composition at their unit cost,
// the semi item gains the portions found by weighing (output weight / portion
// size) and its unit cost becomes the moving average, as in belanja.
const createHttpError = require("http-errors");
const { pool, withTransaction } = require("../../infrastructure/database/pool");
const { roundCost, roundCurrency } = require("../../shared/utils/money");
const { roundRecipeQuantity } = require("../menu/menu.options");
const { refreshMenuCosts } = require("../menu/menu.costs");
const { getStockStatus } = require("./stock.repository");

const roundStock = (value) => Math.round((Number(value) || 0) * 100) / 100;

const formatQuantity = (quantity, unit) =>
  `${Number(quantity).toLocaleString("id-ID", { maximumFractionDigits: 2 })} ${unit}`.trim();

const mapSemiItem = (row) => ({
  _id: row.id,
  id: row.id,
  name: row.name,
  category: row.category,
  unit: row.unit,
  stock: Number(row.stock),
  minimumStock: Number(row.minimum_stock),
  averageCost: Number(row.unit_cost || 0),
  stockValue: Number(row.stock_value || 0),
  portionSize: Number(row.portion_size || 0),
  yieldQuantity: Number(row.yield_quantity || 0),
  status: getStockStatus(row, "HARUS MASAK"),
  isActive: Boolean(row.is_active),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapProduction = (row) => ({
  id: row.id,
  semiItemId: row.semi_item_id,
  itemName: row.item_name,
  batchQuantity: Number(row.batch_quantity),
  outputWeight: row.output_weight == null ? null : Number(row.output_weight),
  portionQuantity: Number(row.portion_quantity),
  cost: Number(row.cost || 0),
  unitCost: Number(row.unit_cost || 0),
  note: row.note || "",
  producedAt: row.produced_at,
  userId: row.user_id,
  userName: row.user_name || "",
});

// Adds to each semi item its composition (one recipe, in each raw item's
// unit), the cost of one recipe at current prices and its latest cooking.
const attachDetails = async (semiItems) => {
  if (!semiItems.length) return semiItems;

  const ids = semiItems.map((item) => item.id);
  const [componentRows] = await pool.query(
    `SELECT sr.semi_item_id, sr.stock_item_id, sr.quantity, sr.cost,
            si.name, si.unit, si.unit_cost
     FROM stock_semi_item_recipes sr
     JOIN stock_raw_items si ON si.id = sr.stock_item_id
     WHERE sr.semi_item_id IN (?)
     ORDER BY sr.sort_order ASC, sr.id ASC`,
    [ids]
  );
  const [productionRows] = await pool.query(
    `SELECT p.*, u.name AS user_name
     FROM stock_semi_item_productions p
     JOIN (
       SELECT semi_item_id, MAX(id) AS id
       FROM stock_semi_item_productions
       WHERE semi_item_id IN (?)
       GROUP BY semi_item_id
     ) latest ON latest.id = p.id
     LEFT JOIN users u ON u.id = p.user_id`,
    [ids]
  );
  const latestByItemId = new Map(
    productionRows.map((row) => [row.semi_item_id, mapProduction(row)])
  );

  return semiItems.map((item) => {
    const components = componentRows
      .filter((row) => row.semi_item_id === item.id)
      .map((row) => ({
        stockItemId: row.stock_item_id,
        name: row.name,
        unit: row.unit,
        quantity: Number(row.quantity),
        unitCost: Number(row.unit_cost || 0),
        cost: Number(row.cost || 0),
      }));

    return {
      ...item,
      components,
      recipeCost: components.reduce((total, component) => total + component.cost, 0),
      lastProduction: latestByItemId.get(item.id) || null,
    };
  });
};

const findAll = async () => {
  const [rows] = await pool.query(
    "SELECT * FROM stock_semi_items WHERE is_active = TRUE ORDER BY name ASC"
  );

  return attachDetails(rows.map(mapSemiItem));
};

const findById = async (id) => {
  const [rows] = await pool.query(
    "SELECT * FROM stock_semi_items WHERE id = ? LIMIT 1",
    [id]
  );
  if (!rows.length) return null;

  const [semiItem] = await attachDetails([mapSemiItem(rows[0])]);
  return semiItem;
};

// Active raw items among ids, to validate a composition.
const findActiveRawIds = async (ids) => {
  if (!ids.length) return [];

  const [rows] = await pool.query(
    "SELECT id FROM stock_raw_items WHERE id IN (?) AND is_active = TRUE",
    [ids]
  );
  return rows.map((row) => row.id);
};

// Names must be unique across bahan baku and bahan setengah jadi.
const isRawItemName = async (name) => {
  const [rows] = await pool.query(
    "SELECT id FROM stock_raw_items WHERE name = ? LIMIT 1",
    [name]
  );
  return rows.length > 0;
};

// Creates or updates a semi item and replaces its composition. Returns the
// item id, or null when id is not found.
const save = (id, { name, category, unit, portionSize, minimumStock, components }) =>
  withTransaction(async (connection) => {
    let semiId = id;

    if (id) {
      const [result] = await connection.query(
        `UPDATE stock_semi_items
         SET name = ?, category = ?, unit = ?, portion_size = ?, minimum_stock = ?
         WHERE id = ?`,
        [name, category, unit, portionSize, minimumStock, id]
      );
      if (!result.affectedRows) return null;
    } else {
      const [result] = await connection.query(
        `INSERT INTO stock_semi_items (name, category, unit, minimum_stock, portion_size)
         VALUES (?, ?, ?, ?, ?)`,
        [name, category, unit, minimumStock, portionSize]
      );
      semiId = result.insertId;
    }

    await connection.query("DELETE FROM stock_semi_item_recipes WHERE semi_item_id = ?", [
      semiId,
    ]);
    await connection.query(
      `INSERT INTO stock_semi_item_recipes (semi_item_id, stock_item_id, quantity, sort_order)
       VALUES ?`,
      [components.map((component, index) => [
        semiId,
        component.stockItemId,
        component.quantity,
        index + 1,
      ])]
    );
    await connection.query(
      `UPDATE stock_semi_item_recipes sr
       JOIN stock_raw_items si ON si.id = sr.stock_item_id
       SET sr.cost = ROUND(sr.quantity * si.unit_cost)
       WHERE sr.semi_item_id = ?`,
      [semiId]
    );

    return semiId;
  });

// Menus whose recipe uses the semi item; recipes block deleting it (ON DELETE RESTRICT).
const findRecipeMenuNames = async (id) => {
  const [rows] = await pool.query(
    `SELECT DISTINCT mi.name
     FROM recipes r
     JOIN menu_items mi ON mi.id = r.menu_item_id
     WHERE r.semi_item_id = ?
     ORDER BY mi.name ASC`,
    [id]
  );

  return rows.map((row) => row.name);
};

// Its composition goes with it; cooking history keeps the name (SET NULL).
const remove = async (id) => {
  const [result] = await pool.query("DELETE FROM stock_semi_items WHERE id = ?", [id]);

  return result.affectedRows > 0;
};

// Manual count of the portions left (e.g. leftovers thrown away); stock_value
// is rescaled at the exact unit cost, as for raw items.
const updateStock = async (id, stock) => {
  const [result] = await pool.query(
    `UPDATE stock_semi_items
     SET stock_value = CASE
           WHEN stock > 0 AND stock_value > 0 THEN ROUND(stock_value * ? / stock, 2)
           ELSE ROUND(? * unit_cost, 2)
         END,
         stock = ?
     WHERE id = ?`,
    [stock, stock, stock, id]
  );

  if (!result.affectedRows) return null;

  return findById(id);
};

// Records one cooking of batchQuantity recipes. The portions come from
// outputWeight / portion_size, or portionQuantity when counted directly.
// Returns the production id, or null when the semi item is not found.
const recordProduction = (semiId, { batchQuantity, outputWeight, portionQuantity, note }, userId) =>
  withTransaction(async (connection) => {
    const [[item]] = await connection.query(
      "SELECT * FROM stock_semi_items WHERE id = ? AND is_active = TRUE FOR UPDATE",
      [semiId]
    );
    if (!item) return null;

    const [components] = await connection.query(
      `SELECT sr.stock_item_id, sr.quantity AS recipe_quantity,
              si.name, si.unit, si.stock, si.unit_cost, si.is_unlimited
       FROM stock_semi_item_recipes sr
       JOIN stock_raw_items si ON si.id = sr.stock_item_id
       WHERE sr.semi_item_id = ?
       ORDER BY si.id
       FOR UPDATE`,
      [semiId]
    );
    if (!components.length) {
      throw createHttpError(400, `Isi komposisi ${item.name} terlebih dahulu.`);
    }

    let portions = portionQuantity;
    if (outputWeight > 0) {
      const portionSize = Number(item.portion_size) || 0;
      if (portionSize <= 0) {
        throw createHttpError(
          400,
          `Isi takaran 1 porsi ${item.name} dulu, atau isi jumlah porsi langsung.`
        );
      }
      portions = outputWeight / portionSize;
    }
    portions = roundStock(portions);
    if (portions <= 0) {
      throw createHttpError(400, "Jumlah porsi hasil masak harus lebih dari 0.");
    }

    const usedItems = components.map((component) => {
      const quantity = roundRecipeQuantity(batchQuantity * Number(component.recipe_quantity));
      const unitCost = Number(component.unit_cost) || 0;
      return { ...component, quantity, unitCost, cost: roundCurrency(quantity * unitCost) };
    });
    const shortages = usedItems.filter(
      (used) => !used.is_unlimited && used.quantity > Number(used.stock)
    );
    if (shortages.length) {
      throw createHttpError(
        409,
        `Stok bahan tidak mencukupi: ${shortages
          .map((used) => `${used.name} butuh ${formatQuantity(used.quantity, used.unit)}, sisa ${formatQuantity(used.stock, used.unit)}`)
          .join("; ")}. Catat belanjanya dulu.`,
        {
          details: {
            insufficientStock: shortages.map((used) => ({
              stockItemId: used.stock_item_id,
              name: used.name,
              stock: Number(used.stock),
              required: used.quantity,
              shortage: used.quantity - Number(used.stock),
              unit: used.unit,
            })),
          },
        }
      );
    }

    // Same stock_value rule as selling a menu (stock.movements).
    for (const used of usedItems) {
      if (used.is_unlimited) continue;
      await connection.query(
        `UPDATE stock_raw_items
         SET stock = stock - ?, stock_value = GREATEST(stock_value - ?, 0)
         WHERE id = ?`,
        [used.quantity, used.cost, used.stock_item_id]
      );
    }

    // Same moving average as a purchase (shopping.service).
    const cost = roundCurrency(usedItems.reduce((total, used) => total + used.cost, 0));
    const previousStock = Math.max(Number(item.stock || 0), 0);
    const previousValue = Math.max(
      Number(item.stock_value || 0),
      roundCurrency(previousStock * Number(item.unit_cost || 0))
    );
    const nextStock = roundStock(Number(item.stock || 0) + portions);
    const nextValue = roundCurrency(previousValue + cost);
    const nextUnitCost = nextStock > 0 ? roundCost(nextValue / nextStock) : 0;
    await connection.query(
      `UPDATE stock_semi_items
       SET stock = ?, stock_value = ?, unit_cost = ?, yield_quantity = ?
       WHERE id = ?`,
      [nextStock, nextValue, nextUnitCost, roundRecipeQuantity(portions / batchQuantity), semiId]
    );

    const [production] = await connection.query(
      `INSERT INTO stock_semi_item_productions
        (semi_item_id, item_name, batch_quantity, output_weight, portion_quantity,
         cost, unit_cost, note, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        semiId,
        item.name,
        batchQuantity,
        outputWeight > 0 ? outputWeight : null,
        portions,
        cost,
        roundCost(cost / portions),
        note || null,
        userId || null,
      ]
    );
    await connection.query(
      `INSERT INTO stock_semi_item_production_items
        (production_id, stock_item_id, item_name, quantity, unit, unit_cost, cost)
       VALUES ?`,
      [usedItems.map((used) => [
        production.insertId,
        used.stock_item_id,
        used.name,
        used.quantity,
        used.unit,
        used.unitCost,
        used.cost,
      ])]
    );
    await refreshMenuCosts(connection, { semiItemIds: [semiId] });

    return production.insertId;
  });

// Latest cookings of a semi item with the raw items each one used.
const listProductions = async (semiId, limit = 30) => {
  const [rows] = await pool.query(
    `SELECT p.*, u.name AS user_name
     FROM stock_semi_item_productions p
     LEFT JOIN users u ON u.id = p.user_id
     WHERE p.semi_item_id = ?
     ORDER BY p.id DESC
     LIMIT ?`,
    [semiId, limit]
  );
  if (!rows.length) return [];

  const [itemRows] = await pool.query(
    `SELECT * FROM stock_semi_item_production_items
     WHERE production_id IN (?)
     ORDER BY id ASC`,
    [rows.map((row) => row.id)]
  );

  return rows.map((row) => ({
    ...mapProduction(row),
    items: itemRows
      .filter((itemRow) => itemRow.production_id === row.id)
      .map((itemRow) => ({
        stockItemId: itemRow.stock_item_id,
        name: itemRow.item_name,
        quantity: Number(itemRow.quantity),
        unit: itemRow.unit,
        unitCost: Number(itemRow.unit_cost || 0),
        cost: Number(itemRow.cost || 0),
      })),
  }));
};

// Undoes the latest cooking of an item (e.g. a typo) while its portions are
// still in stock: the raw items get their stock back and the portions are
// removed. Returns the semi item id (0 when it was deleted), or null when the
// cooking is not found.
const deleteProduction = (productionId) =>
  withTransaction(async (connection) => {
    const [[production]] = await connection.query(
      "SELECT * FROM stock_semi_item_productions WHERE id = ? FOR UPDATE",
      [productionId]
    );
    if (!production) return null;

    const semiId = production.semi_item_id;
    const portions = Number(production.portion_quantity);
    let item = null;

    if (semiId) {
      const [[latest]] = await connection.query(
        "SELECT MAX(id) AS id FROM stock_semi_item_productions WHERE semi_item_id = ?",
        [semiId]
      );
      if (latest.id !== production.id) {
        throw createHttpError(409, "Hanya catatan masak terakhir yang bisa dibatalkan.");
      }

      [[item]] = await connection.query(
        "SELECT * FROM stock_semi_items WHERE id = ? FOR UPDATE",
        [semiId]
      );
      if (Number(item.stock) < portions) {
        throw createHttpError(
          409,
          `${portions} porsi dari masak ini sudah sebagian terpakai (sisa stok ${Number(item.stock)}). Sesuaikan stoknya saja.`
        );
      }
    }

    const [usedItems] = await connection.query(
      "SELECT * FROM stock_semi_item_production_items WHERE production_id = ? AND stock_item_id IS NOT NULL",
      [productionId]
    );
    for (const used of usedItems) {
      await connection.query(
        `UPDATE stock_raw_items
         SET stock = CASE WHEN is_unlimited = TRUE THEN stock ELSE stock + ? END,
             stock_value = CASE WHEN is_unlimited = TRUE THEN stock_value ELSE stock_value + ? END
         WHERE id = ?`,
        [Number(used.quantity), Number(used.cost), used.stock_item_id]
      );
    }

    await connection.query("DELETE FROM stock_semi_item_productions WHERE id = ?", [productionId]);

    if (item) {
      const [[previous]] = await connection.query(
        `SELECT unit_cost, portion_quantity / batch_quantity AS yield_quantity
         FROM stock_semi_item_productions
         WHERE semi_item_id = ?
         ORDER BY id DESC
         LIMIT 1`,
        [semiId]
      );
      const nextStock = roundStock(Number(item.stock) - portions);
      const nextValue = roundCurrency(Math.max(Number(item.stock_value) - Number(production.cost), 0));
      // With no portions left, keep the previous cooking's cost for menu HPP.
      const nextUnitCost = nextStock > 0
        ? roundCost(nextValue / nextStock)
        : Number(previous?.unit_cost || 0);
      await connection.query(
        `UPDATE stock_semi_items
         SET stock = ?, stock_value = ?, unit_cost = ?, yield_quantity = ?
         WHERE id = ?`,
        [
          nextStock,
          nextValue,
          nextUnitCost,
          roundRecipeQuantity(previous?.yield_quantity || 0),
          semiId,
        ]
      );
      await refreshMenuCosts(connection, { semiItemIds: [semiId] });
    }

    return semiId || 0;
  });

module.exports = {
  deleteProduction,
  findActiveRawIds,
  findAll,
  findById,
  findRecipeMenuNames,
  isRawItemName,
  listProductions,
  recordProduction,
  remove,
  save,
  updateStock,
};
