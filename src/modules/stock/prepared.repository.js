// Prepared items (bahan olahan, e.g. Nasi from Beras): composition, cooking
// ("Catat Masak") and its history. Tables: see preparedItemsSchema.js.
//
// Cooking moves stock like a purchase of the prepared item paid with raw
// items: the raw items lose batch x composition (at their unit cost), the
// prepared item gains the portions found by weighing (output weight / portion
// size) and its unit cost becomes the moving average, as in belanja.
const createHttpError = require("http-errors");
const { pool, withTransaction } = require("../../infrastructure/database/pool");
const { roundCost, roundCurrency } = require("../../shared/utils/money");
const { roundRecipeQuantity } = require("../menu/menu.options");
const { refreshMenuCosts } = require("../menu/menu.costs");
const { mapProduction } = require("./stock.repository");

const roundStock = (value) => Math.round((Number(value) || 0) * 100) / 100;

const formatQuantity = (quantity, unit) =>
  `${Number(quantity).toLocaleString("id-ID", { maximumFractionDigits: 2 })} ${unit}`.trim();

// Active stock items by id with whether they are prepared, to validate components.
const findKinds = async (ids) => {
  if (!ids.length) return [];

  const [rows] = await pool.query(
    "SELECT id, name, is_prepared FROM stock_items WHERE id IN (?) AND is_active = TRUE",
    [ids]
  );
  return rows.map((row) => ({ id: row.id, name: row.name, isPrepared: Boolean(row.is_prepared) }));
};

// Creates or updates a prepared item and replaces its composition. Returns the
// item id, or null when id is not a prepared item.
const savePrepared = (id, { name, category, unit, portionSize, minimumStock, components }) =>
  withTransaction(async (connection) => {
    let preparedId = id;

    if (id) {
      const [result] = await connection.query(
        `UPDATE stock_items
         SET name = ?, category = ?, unit = ?, portion_size = ?, minimum_stock = ?
         WHERE id = ? AND is_prepared = TRUE`,
        [name, category, unit, portionSize, minimumStock, id]
      );
      if (!result.affectedRows) return null;
    } else {
      const [result] = await connection.query(
        `INSERT INTO stock_items
          (name, category, unit, stock, minimum_stock, unit_cost, stock_value,
           is_prepared, portion_size, yield_quantity)
         VALUES (?, ?, ?, 0, ?, 0, 0, TRUE, ?, 0)`,
        [name, category, unit, minimumStock, portionSize]
      );
      preparedId = result.insertId;
    }

    await connection.query("DELETE FROM stock_item_recipes WHERE prepared_item_id = ?", [
      preparedId,
    ]);
    await connection.query(
      `INSERT INTO stock_item_recipes (prepared_item_id, stock_item_id, quantity, sort_order)
       VALUES ?`,
      [components.map((component, index) => [
        preparedId,
        component.stockItemId,
        component.quantity,
        index + 1,
      ])]
    );
    await connection.query(
      `UPDATE stock_item_recipes pr
       JOIN stock_items si ON si.id = pr.stock_item_id
       SET pr.cost = ROUND(pr.quantity * si.unit_cost)
       WHERE pr.prepared_item_id = ?`,
      [preparedId]
    );

    return preparedId;
  });

// Records one cooking of batchQuantity recipes. The portions come from
// outputWeight / portion_size, or portionQuantity when counted directly.
// Returns the production id, or null when the item is not a prepared item.
const recordProduction = (preparedId, { batchQuantity, outputWeight, portionQuantity, note }, userId) =>
  withTransaction(async (connection) => {
    const [[item]] = await connection.query(
      "SELECT * FROM stock_items WHERE id = ? AND is_prepared = TRUE AND is_active = TRUE FOR UPDATE",
      [preparedId]
    );
    if (!item) return null;

    const [components] = await connection.query(
      `SELECT pr.stock_item_id, pr.quantity AS recipe_quantity,
              si.name, si.unit, si.stock, si.unit_cost, si.is_unlimited
       FROM stock_item_recipes pr
       JOIN stock_items si ON si.id = pr.stock_item_id
       WHERE pr.prepared_item_id = ?
       ORDER BY si.id
       FOR UPDATE`,
      [preparedId]
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
        `UPDATE stock_items
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
      `UPDATE stock_items
       SET stock = ?, stock_value = ?, unit_cost = ?, yield_quantity = ?
       WHERE id = ?`,
      [nextStock, nextValue, nextUnitCost, roundRecipeQuantity(portions / batchQuantity), preparedId]
    );

    const [production] = await connection.query(
      `INSERT INTO stock_item_productions
        (prepared_item_id, item_name, batch_quantity, output_weight, portion_quantity,
         cost, unit_cost, note, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        preparedId,
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
      `INSERT INTO stock_item_production_items
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
    await refreshMenuCosts(connection, { stockItemIds: [preparedId] });

    return production.insertId;
  });

// Latest cookings of a prepared item with the raw items each one used.
const listProductions = async (preparedId, limit = 30) => {
  const [rows] = await pool.query(
    `SELECT p.*, u.name AS user_name
     FROM stock_item_productions p
     LEFT JOIN users u ON u.id = p.user_id
     WHERE p.prepared_item_id = ?
     ORDER BY p.id DESC
     LIMIT ?`,
    [preparedId, limit]
  );
  if (!rows.length) return [];

  const [itemRows] = await pool.query(
    `SELECT * FROM stock_item_production_items
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
// removed. Returns the prepared item id, or null when the cooking is not found.
const deleteProduction = (productionId) =>
  withTransaction(async (connection) => {
    const [[production]] = await connection.query(
      "SELECT * FROM stock_item_productions WHERE id = ? FOR UPDATE",
      [productionId]
    );
    if (!production) return null;

    const preparedId = production.prepared_item_id;
    const portions = Number(production.portion_quantity);
    let item = null;

    if (preparedId) {
      const [[latest]] = await connection.query(
        "SELECT MAX(id) AS id FROM stock_item_productions WHERE prepared_item_id = ?",
        [preparedId]
      );
      if (latest.id !== production.id) {
        throw createHttpError(409, "Hanya catatan masak terakhir yang bisa dibatalkan.");
      }

      [[item]] = await connection.query(
        "SELECT * FROM stock_items WHERE id = ? FOR UPDATE",
        [preparedId]
      );
      if (Number(item.stock) < portions) {
        throw createHttpError(
          409,
          `${portions} porsi dari masak ini sudah sebagian terpakai (sisa stok ${Number(item.stock)}). Sesuaikan stoknya saja.`
        );
      }
    }

    const [usedItems] = await connection.query(
      "SELECT * FROM stock_item_production_items WHERE production_id = ? AND stock_item_id IS NOT NULL",
      [productionId]
    );
    for (const used of usedItems) {
      await connection.query(
        `UPDATE stock_items
         SET stock = CASE WHEN is_unlimited = TRUE THEN stock ELSE stock + ? END,
             stock_value = CASE WHEN is_unlimited = TRUE THEN stock_value ELSE stock_value + ? END
         WHERE id = ?`,
        [Number(used.quantity), Number(used.cost), used.stock_item_id]
      );
    }

    await connection.query("DELETE FROM stock_item_productions WHERE id = ?", [productionId]);

    if (item) {
      const [[previous]] = await connection.query(
        `SELECT unit_cost, portion_quantity / batch_quantity AS yield_quantity
         FROM stock_item_productions
         WHERE prepared_item_id = ?
         ORDER BY id DESC
         LIMIT 1`,
        [preparedId]
      );
      const nextStock = roundStock(Number(item.stock) - portions);
      const nextValue = roundCurrency(Math.max(Number(item.stock_value) - Number(production.cost), 0));
      // With no portions left, keep the previous cooking's cost for menu HPP.
      const nextUnitCost = nextStock > 0
        ? roundCost(nextValue / nextStock)
        : Number(previous?.unit_cost || 0);
      await connection.query(
        `UPDATE stock_items
         SET stock = ?, stock_value = ?, unit_cost = ?, yield_quantity = ?
         WHERE id = ?`,
        [
          nextStock,
          nextValue,
          nextUnitCost,
          roundRecipeQuantity(previous?.yield_quantity || 0),
          preparedId,
        ]
      );
      await refreshMenuCosts(connection, { stockItemIds: [preparedId] });
    }

    return preparedId || 0;
  });

module.exports = {
  deleteProduction,
  findKinds,
  listProductions,
  recordProduction,
  savePrepared,
};
