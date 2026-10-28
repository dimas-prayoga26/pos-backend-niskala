// Bahan setengah jadi (stock_semi_items, e.g. Nasi from Beras): composition,
// cooking ("Catat Masak"), write-offs (kerugian) and their history. Tables:
// see semiItemsSchema.js.
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
  resetDaily: Boolean(row.reset_daily),
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
const save = (id, { name, category, unit, portionSize, minimumStock, resetDaily, components }) =>
  withTransaction(async (connection) => {
    let semiId = id;

    if (id) {
      const [result] = await connection.query(
        `UPDATE stock_semi_items
         SET name = ?, category = ?, unit = ?, portion_size = ?, minimum_stock = ?, reset_daily = ?
         WHERE id = ?`,
        [name, category, unit, portionSize, minimumStock, resetDaily ? 1 : 0, id]
      );
      if (!result.affectedRows) return null;
    } else {
      const [result] = await connection.query(
        `INSERT INTO stock_semi_items (name, category, unit, minimum_stock, portion_size, reset_daily)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [name, category, unit, minimumStock, portionSize, resetDaily ? 1 : 0]
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

// Menus whose recipe uses the semi item; they block deleting it (ON DELETE RESTRICT).
const findRecipeMenuNames = async (id) => {
  const [rows] = await pool.query(
    `SELECT DISTINCT mi.name
     FROM stock_semi_item_menus sm
     JOIN menu_items mi ON mi.id = sm.menu_item_id
     WHERE sm.semi_item_id = ?
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

// Business day of a manual write-off (server time zone, Asia/Jakarta).
const today = () => {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
};

// Writes off quantity portions of a locked semi item row: its stock and
// stock_value drop at the exact unit cost (stock_value / stock) and one
// history_stock_semi_wastes row keeps the loss.
const writeOff = async (connection, item, { quantity, reason, note, wasteDate, userId }) => {
  const stock = Number(item.stock) || 0;
  const value = Number(item.stock_value) || 0;
  const portions = roundStock(quantity);
  const cost = stock > 0 && value > 0
    ? roundCurrency((value * portions) / stock)
    : roundCurrency(portions * Number(item.unit_cost || 0));

  await connection.query(
    "UPDATE stock_semi_items SET stock = ?, stock_value = ? WHERE id = ?",
    [roundStock(stock - portions), Math.max(roundCurrency(value - cost), 0), item.id]
  );
  await connection.query(
    `INSERT INTO history_stock_semi_wastes
      (semi_item_id, item_name, waste_date, quantity, unit, unit_cost, cost, reason, note, user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      item.id,
      item.name,
      wasteDate || today(),
      portions,
      item.unit,
      portions > 0 ? roundCost(cost / portions) : Number(item.unit_cost || 0),
      cost,
      reason,
      note || null,
      userId || null,
    ]
  );

  return cost;
};

// Manual count of the portions left. A lower count is written off as
// "Penyesuaian" (kerugian); a higher one rescales stock_value at the exact
// unit cost, as for raw items.
const updateStock = (id, stock, userId) =>
  withTransaction(async (connection) => {
    const [[item]] = await connection.query(
      "SELECT * FROM stock_semi_items WHERE id = ? FOR UPDATE",
      [id]
    );
    if (!item) return false;

    const missing = roundStock(Number(item.stock) - stock);
    if (missing > 0 && Number(item.stock) > 0) {
      await writeOff(connection, item, { quantity: missing, reason: "Penyesuaian", userId });
    } else {
      await connection.query(
        `UPDATE stock_semi_items
         SET stock_value = CASE
               WHEN stock > 0 AND stock_value > 0 THEN ROUND(stock_value * ? / stock, 2)
               ELSE ROUND(? * unit_cost, 2)
             END,
             stock = ?
         WHERE id = ?`,
        [stock, stock, stock, id]
      );
    }

    return true;
  }).then((updated) => (updated ? findById(id) : null));

// Portions thrown away during the day (spoiled, spilled, ...). Returns false
// when the item is not found.
const recordWaste = (semiId, { quantity, reason, note }, userId) =>
  withTransaction(async (connection) => {
    const [[item]] = await connection.query(
      "SELECT * FROM stock_semi_items WHERE id = ? FOR UPDATE",
      [semiId]
    );
    if (!item) return false;

    const available = Number(item.stock) || 0;
    if (quantity > available) {
      throw createHttpError(
        409,
        `Stok ${item.name} tinggal ${formatQuantity(Math.max(available, 0), item.unit)}.`
      );
    }

    await writeOff(connection, item, { quantity, reason, note, userId });
    return true;
  });

// Closing of a business day (saving its daily recap): the leftover of every
// reset_daily semi item is written off as "Sisa akhir hari", so the next day
// starts from zero. Portions cooked after that day (a recap saved the next
// morning) stay in stock; sales are assumed to use the oldest portions first.
// Runs in the caller's transaction; returns the written-off items.
const closeDay = async (connection, { date, userId }) => {
  const [items] = await connection.query(
    `SELECT * FROM stock_semi_items
     WHERE reset_daily = TRUE AND is_active = TRUE AND stock > 0
     ORDER BY id
     FOR UPDATE`
  );
  const closed = [];

  for (const item of items) {
    const [[later]] = await connection.query(
      `SELECT COALESCE(SUM(portion_quantity), 0) AS portions
       FROM stock_semi_item_productions
       WHERE semi_item_id = ? AND produced_at >= DATE_ADD(?, INTERVAL 1 DAY)`,
      [item.id, date]
    );
    const leftover = roundStock(Number(item.stock) - Number(later.portions));
    if (leftover <= 0) continue;

    const cost = await writeOff(connection, item, {
      quantity: leftover,
      reason: "Sisa akhir hari",
      wasteDate: date,
      userId,
    });
    closed.push({ semiItemId: item.id, name: item.name, quantity: leftover, cost });
  }

  return closed;
};

const mapWaste = (row) => ({
  id: row.id,
  semiItemId: row.semi_item_id,
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
const listWastes = async ({ from, to, semiItemId, limit = 100 } = {}) => {
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
  if (semiItemId) {
    conditions.push("w.semi_item_id = ?");
    params.push(semiItemId);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const [rows] = await pool.query(
    `SELECT w.*, u.name AS user_name
     FROM history_stock_semi_wastes w
     LEFT JOIN users u ON u.id = w.user_id
     ${where}
     ORDER BY w.waste_date DESC, w.id DESC
     LIMIT ?`,
    [...params, limit]
  );
  const [totals] = await pool.query(
    `SELECT w.waste_date, SUM(w.cost) AS cost, COUNT(*) AS entries
     FROM history_stock_semi_wastes w
     ${where}
     GROUP BY w.waste_date
     ORDER BY w.waste_date DESC`,
    params
  );

  return {
    wastes: rows.map(mapWaste),
    dailyTotals: totals.map((row) => ({
      date: row.waste_date,
      cost: Number(row.cost || 0),
      entries: Number(row.entries),
    })),
  };
};

// Undoes the latest write-off of an item (a typo): its portions and value go
// back to stock. Returns the semi item id (0 when it was deleted), or null
// when the write-off is not found.
const deleteWaste = (wasteId) =>
  withTransaction(async (connection) => {
    const [[waste]] = await connection.query(
      "SELECT * FROM history_stock_semi_wastes WHERE id = ? FOR UPDATE",
      [wasteId]
    );
    if (!waste) return null;

    if (waste.semi_item_id) {
      const [[latest]] = await connection.query(
        "SELECT MAX(id) AS id FROM history_stock_semi_wastes WHERE semi_item_id = ?",
        [waste.semi_item_id]
      );
      if (latest.id !== waste.id) {
        throw createHttpError(409, "Hanya catatan buang terakhir yang bisa dibatalkan.");
      }

      await connection.query(
        `UPDATE stock_semi_items
         SET stock = stock + ?, stock_value = stock_value + ?
         WHERE id = ?`,
        [Number(waste.quantity), Number(waste.cost), waste.semi_item_id]
      );
    }

    await connection.query("DELETE FROM history_stock_semi_wastes WHERE id = ?", [wasteId]);
    return waste.semi_item_id || 0;
  });

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
  closeDay,
  deleteProduction,
  deleteWaste,
  findActiveRawIds,
  findAll,
  findById,
  findRecipeMenuNames,
  isRawItemName,
  listProductions,
  listWastes,
  recordProduction,
  recordWaste,
  remove,
  save,
  updateStock,
};
