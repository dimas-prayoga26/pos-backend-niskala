// One-time fill of the COGS sheet (2026-11-09), after the category seed. It
// runs once (seed_runs), so what the admin changes later stays:
// - the sheet's bahan the COGS seed missed are added, one pack in stock;
// - its menus the COGS seed missed are added in their tab's category;
// - a menu on a Hot tab and an Ice tab gets a second menu of the same name in
//   the Hot category, with the Ice menu's prices and the Hot tab's recipe;
// - a tab's menu that sits in the tab's category without a photo and off the
//   POS (as the COGS seed added it) is put on the POS.
const logger = require("../../../shared/logger");
const { pool, withTransaction } = require("../pool");
const { keyOf, recipeRowsOf } = require("./cogsSeed");
const { SEED_NAME: CATEGORY_SEED_NAME, SHEET_CATEGORIES } = require("./cogsCategorySeed");
const { cogsExtraMenus, cogsExtraStockItems, cogsHotMenus } = require("./cogsSheetData");

const SEED_NAME = "cogs-menus-2026-11";

const stockByKeyOf = async (connection) => {
  const [rows] = await connection.query("SELECT id, name, unit FROM stock_raw_items");
  return new Map(rows.map((row) => [keyOf(row.name), row]));
};

const insertRecipe = async (connection, menu, menuItemId, stockByKey, skipped) => {
  const rows = recipeRowsOf(menu, menuItemId, stockByKey, skipped);
  if (!rows.length) return;
  await connection.query(
    "INSERT INTO menu_item_recipes (menu_item_id, stock_item_id, quantity, sort_order) VALUES ?",
    [rows]
  );
};

// As the COGS seed: stock = packSize, unit cost = packPrice / packSize.
const addMissingBahan = async (connection) => {
  const stockByKey = await stockByKeyOf(connection);
  const added = [];
  for (const [name, category, unit, packSize, packPrice] of cogsExtraStockItems) {
    if (stockByKey.has(keyOf(name))) continue;
    await connection.query(
      `INSERT INTO stock_raw_items (name, category, unit, stock, minimum_stock, unit_cost, stock_value)
       VALUES (?, ?, ?, ?, 0, ?, ?)`,
      [name, category, unit, packSize, Math.round(packPrice / packSize), packPrice]
    );
    added.push(name);
  }
  return added;
};

const addExtraMenus = async (connection, categoryIdByKey, skipped) => {
  const stockByKey = await stockByKeyOf(connection);
  const [menuRows] = await connection.query("SELECT name FROM menu_items");
  const names = new Set(menuRows.map((row) => keyOf(row.name)));
  const added = [];

  for (const menu of cogsExtraMenus) {
    const categoryId = categoryIdByKey.get(keyOf(menu.category));
    if (!categoryId || names.has(keyOf(menu.name))) continue;

    const [result] = await connection.query(
      `INSERT INTO menu_items (category_id, name, include_online_platform, image_path, is_available)
       VALUES (?, ?, FALSE, NULL, TRUE)`,
      [categoryId, menu.name]
    );
    await connection.query(
      `INSERT INTO menu_item_prices (menu_item_id, regular_price, online_price, hpp_cost, gross_profit)
       VALUES (?, ?, NULL, 0, ?)`,
      [result.insertId, menu.price, menu.price]
    );
    await insertRecipe(connection, menu, result.insertId, stockByKey, skipped);
    added.push(`${menu.category}: ${menu.name}`);
  }
  return added;
};

const addHotMenus = async (connection, categoryIdByKey, skipped) => {
  const stockByKey = await stockByKeyOf(connection);
  const [menuRows] = await connection.query(
    `SELECT mi.id, mi.name, mi.category_id, mi.include_online_platform,
            mip.regular_price, mip.online_price, mip.hpp_cost
     FROM menu_items mi
     LEFT JOIN menu_item_prices mip ON mip.menu_item_id = mi.id
     ORDER BY mi.id`
  );
  const added = [];

  for (const menu of cogsHotMenus) {
    const categoryId = categoryIdByKey.get(keyOf(menu.category));
    const named = menuRows.filter((row) => keyOf(row.name) === keyOf(menu.name));
    if (!categoryId || named.some((row) => Number(row.category_id) === categoryId)) continue;

    // The Ice menu: its name and prices, the sheet's price when it is gone.
    // Its HPP holds until the Hot recipe costs something (refreshMenuCosts).
    const ice = named[0];
    const regularPrice = ice?.regular_price == null ? menu.price : Number(ice.regular_price);
    const hppCost = Number(ice?.hpp_cost) || 0;
    const [result] = await connection.query(
      `INSERT INTO menu_items (category_id, name, include_online_platform, image_path, is_available)
       VALUES (?, ?, ?, NULL, TRUE)`,
      [categoryId, ice?.name || menu.name, Boolean(ice?.include_online_platform)]
    );
    await connection.query(
      `INSERT INTO menu_item_prices (menu_item_id, regular_price, online_price, hpp_cost, gross_profit)
       VALUES (?, ?, ?, ?, ?)`,
      [result.insertId, regularPrice, ice?.online_price ?? null, hppCost, regularPrice - hppCost]
    );
    await insertRecipe(connection, menu, result.insertId, stockByKey, skipped);
    added.push(`${menu.category}: ${menu.name}`);
  }
  return added;
};

const turnOnSheetMenus = async (connection, categoryIdByKey) => {
  const menusOfCategory = new Map(
    SHEET_CATEGORIES.map((tab) => [categoryIdByKey.get(keyOf(tab.name)), new Set(tab.menus.map(keyOf))])
  );
  const [rows] = await connection.query(
    `SELECT id, name, category_id FROM menu_items
     WHERE is_available = FALSE AND (image_path IS NULL OR image_path = '')`
  );
  const menus = rows.filter((row) => menusOfCategory.get(Number(row.category_id))?.has(keyOf(row.name)));
  if (menus.length) {
    await connection.query("UPDATE menu_items SET is_available = TRUE WHERE id IN (?)", [
      menus.map((row) => row.id),
    ]);
  }
  return menus.map((row) => row.name);
};

// Runs once per database, after the category seed has. A failure is logged
// and retried on the next boot instead of stopping the server.
const seedCogsMenuFill = async () => {
  await pool.query(`CREATE TABLE IF NOT EXISTS seed_runs (
    name VARCHAR(100) PRIMARY KEY,
    ran_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);
  const [runs] = await pool.query("SELECT name FROM seed_runs WHERE name IN (?)", [
    [SEED_NAME, CATEGORY_SEED_NAME],
  ]);
  const ran = new Set(runs.map((run) => run.name));
  if (ran.has(SEED_NAME) || !ran.has(CATEGORY_SEED_NAME)) return null;

  try {
    const summary = await withTransaction(async (connection) => {
      // Claimed first, so a second process booting at the same time stops here.
      await connection.query("INSERT INTO seed_runs (name) VALUES (?)", [SEED_NAME]);
      const [categories] = await connection.query("SELECT id, name FROM categories ORDER BY id");
      const categoryIdByKey = new Map();
      for (const category of categories) {
        if (!categoryIdByKey.has(keyOf(category.name))) categoryIdByKey.set(keyOf(category.name), Number(category.id));
      }
      const skippedLines = [];
      const bahan = await addMissingBahan(connection);
      const menus = await addExtraMenus(connection, categoryIdByKey, skippedLines);
      const hotMenus = await addHotMenus(connection, categoryIdByKey, skippedLines);
      const turnedOn = await turnOnSheetMenus(connection, categoryIdByKey);
      return { bahan, menus, hotMenus, turnedOn, skippedLines };
    });

    logger.info("COGS sheet menus filled", { seed: SEED_NAME, ...summary });
    return summary;
  } catch (error) {
    if (error.code !== "ER_DUP_ENTRY") {
      logger.error("COGS menu fill seed failed; retried on the next boot", { error: error.message });
    }
    return null;
  }
};

module.exports = { SEED_NAME, seedCogsMenuFill };
