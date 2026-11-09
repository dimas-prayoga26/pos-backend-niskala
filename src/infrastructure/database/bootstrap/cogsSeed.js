// One-time, add-only seed from the COGS sheet (cogsSheetData.js). It runs at
// boot until it has succeeded once (seed_runs), so data the admin edits or
// deletes later is never touched again:
// - a bahan missing from stock_raw_items (bahan baku) is added with one pack in stock
//   (stock = packSize, unit cost = packPrice / packSize, value = packPrice);
// - a menu missing from menu_items is added at the sheet's price, not
//   available in the POS until the admin adds its photo and turns it on;
// - a menu without any recipe line gets the sheet's recipe, quantities moved
//   to the bahan's unit (a line whose unit cannot be converted is skipped).
// Bahan, menus, prices, stock and recipes that already exist stay as they are.
const logger = require("../../../shared/logger");
const { areConvertible, convertBetweenUnits } = require("../../../shared/utils/units");
const { pool, withTransaction } = require("../pool");
const { cogsExtraStockItems, cogsMenus, cogsStockItems } = require("./cogsSheetData");

const SEED_NAME = "cogs-sheet-2026-11";
const CATEGORY_ICONS = { "Roti Kukus": "\u{1F35E}" };

// Names match ignoring case, spaces and punctuation ("Coca-Cola" = "COCA COLA").
const keyOf = (name) => String(name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
// Units that count pieces: a sedotan in "batang" or an Indomie in "bungkus" is 1 pcs.
const PIECE_UNITS = new Set(["pcs", "pc", "buah", "batang", "bungkus", "butir", "biji", "lembar"]);
const normalizeUnit = (unit) => {
  const value = String(unit || "").trim().toLowerCase();
  return PIECE_UNITS.has(value) ? "pcs" : value;
};
const seedUnitOf = new Map(
  [...cogsStockItems, ...cogsExtraStockItems].map(([name, , unit]) => [keyOf(name), unit])
);

// The quantity in the bahan's own unit, or null when the units do not convert.
const toStockUnit = (quantity, fromUnit, toUnit) => {
  const from = normalizeUnit(fromUnit);
  const to = normalizeUnit(toUnit);
  if (from === to) return quantity;
  if (!areConvertible(from, to)) return null;
  return Math.round(convertBetweenUnits(quantity, from, to) * 10000) / 10000;
};

const addMissingStock = async (connection) => {
  const [rows] = await connection.query("SELECT id, name, unit FROM stock_raw_items");
  const stockByKey = new Map(rows.map((row) => [keyOf(row.name), row]));
  let added = 0;

  for (const [name, category, unit, packSize, packPrice] of cogsStockItems) {
    if (stockByKey.has(keyOf(name))) continue;

    const [result] = await connection.query(
      `INSERT INTO stock_raw_items (name, category, unit, stock, minimum_stock, unit_cost, stock_value)
       VALUES (?, ?, ?, ?, 0, ?, ?)`,
      [name, category, unit, packSize, Math.round(packPrice / packSize), packPrice]
    );
    stockByKey.set(keyOf(name), { id: result.insertId, name, unit });
    added += 1;
  }

  return { stockByKey, added };
};

const categoryIdFor = async (connection, name, categoryByKey) => {
  const existing = categoryByKey.get(keyOf(name));
  if (existing) return existing;

  const [[next]] = await connection.query(
    "SELECT COALESCE(MAX(sort_order), 0) + 10 AS sort_order FROM categories"
  );
  const [result] = await connection.query(
    "INSERT INTO categories (name, icon, sort_order) VALUES (?, ?, ?)",
    [name, CATEGORY_ICONS[name] || null, next.sort_order]
  );
  categoryByKey.set(keyOf(name), result.insertId);
  return result.insertId;
};

// The sheet's recipe as rows of one menu; repeats of a bahan are summed.
const recipeRowsOf = (menu, menuItemId, stockByKey, skipped) => {
  const quantityByStockId = new Map();

  for (const [bahan, quantity] of menu.recipe) {
    const stock = stockByKey.get(keyOf(bahan));
    const converted = stock ? toStockUnit(quantity, seedUnitOf.get(keyOf(bahan)), stock.unit) : null;
    if (converted === null) {
      skipped.push(`${menu.name}: ${bahan}`);
      continue;
    }
    quantityByStockId.set(stock.id, (quantityByStockId.get(stock.id) || 0) + converted);
  }

  return [...quantityByStockId].map(([stockItemId, quantity], index) => [
    menuItemId,
    stockItemId,
    quantity,
    index + 1,
  ]);
};

const addMissingMenus = async (connection, stockByKey) => {
  const [categoryRows] = await connection.query("SELECT id, name FROM categories");
  const categoryByKey = new Map(categoryRows.map((row) => [keyOf(row.name), row.id]));
  const [menuRows] = await connection.query("SELECT id, name FROM menu_items");
  const menuByKey = new Map(menuRows.map((row) => [keyOf(row.name), row.id]));
  const [recipeRows] = await connection.query(
    // A menu with bahan baku or bahan olahan lines already has a recipe.
    "SELECT menu_item_id FROM menu_item_recipes UNION SELECT menu_item_id FROM stock_semi_item_menus"
  );
  const withRecipe = new Set(recipeRows.map((row) => Number(row.menu_item_id)));
  const summary = { menus: 0, recipes: 0, skipped: [] };

  for (const menu of cogsMenus) {
    let menuItemId = [menu.name, ...menu.aliases]
      .map((name) => menuByKey.get(keyOf(name)))
      .find(Boolean);

    if (!menuItemId) {
      const categoryId = await categoryIdFor(connection, menu.category, categoryByKey);
      const [result] = await connection.query(
        `INSERT INTO menu_items (category_id, name, include_online_platform, image_path, is_available)
         VALUES (?, ?, FALSE, NULL, FALSE)`,
        [categoryId, menu.name]
      );
      menuItemId = result.insertId;
      await connection.query(
        `INSERT INTO menu_item_prices (menu_item_id, regular_price, online_price, hpp_cost, gross_profit)
         VALUES (?, ?, NULL, 0, ?)`,
        [menuItemId, menu.price, menu.price]
      );
      menuByKey.set(keyOf(menu.name), menuItemId);
      summary.menus += 1;
    }

    if (!menu.recipe || withRecipe.has(Number(menuItemId))) continue;

    const rows = recipeRowsOf(menu, menuItemId, stockByKey, summary.skipped);
    if (!rows.length) continue;

    await connection.query(
      "INSERT INTO menu_item_recipes (menu_item_id, stock_item_id, quantity, sort_order) VALUES ?",
      [rows]
    );
    withRecipe.add(Number(menuItemId));
    summary.recipes += 1;
  }

  return summary;
};

// Runs the seed once per database. A failure is logged and retried on the
// next boot instead of stopping the server.
const seedCogsSheet = async () => {
  await pool.query(`CREATE TABLE IF NOT EXISTS seed_runs (
    name VARCHAR(100) PRIMARY KEY,
    ran_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);
  const [done] = await pool.query("SELECT name FROM seed_runs WHERE name = ?", [SEED_NAME]);
  if (done.length) return null;

  try {
    const summary = await withTransaction(async (connection) => {
      // Claimed first, so a second process booting at the same time stops here.
      await connection.query("INSERT INTO seed_runs (name) VALUES (?)", [SEED_NAME]);
      const { stockByKey, added } = await addMissingStock(connection);
      return { stockItems: added, ...(await addMissingMenus(connection, stockByKey)) };
    });

    logger.info("COGS sheet seeded", {
      seed: SEED_NAME,
      stockItems: summary.stockItems,
      menus: summary.menus,
      recipes: summary.recipes,
      skippedLines: summary.skipped,
    });
    return summary;
  } catch (error) {
    if (error.code !== "ER_DUP_ENTRY") {
      logger.error("COGS sheet seed failed; retried on the next boot", { error: error.message });
    }
    return null;
  }
};

module.exports = { SEED_NAME, keyOf, recipeRowsOf, seedCogsSheet };
