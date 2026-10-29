const logger = require("../../../shared/logger");
const { roundCurrency } = require("../../../shared/utils/money");
const { convertRecipeQuantity } = require("../../../shared/utils/units");
const { pool, withTransaction } = require("../pool");
const {
  PRICE_ROW_COLUMNS,
  roundRecipeQuantity,
  toPriceRow,
} = require("../../../modules/menu/menu.options");
const { getColumnNames, runSafeMigration, tableExists } = require("./helpers");
const {
  seedCategories,
  seedMenuCatalog,
  seedMenuFinancials,
  seedMenuIngredients,
} = require("./seedData");

const normalizeSizeName = (value) => String(value || "").trim().toLowerCase();

// Menus used to have optional sizes. Each menu now keeps one price: its base
// price, or for a sized menu its first size. Returns menuItemId -> that size's
// name (lower case) so the recipe rows of that size can be folded in as well.
const findKeptMenuSizes = async () => {
  let rows = [];

  if ((await getColumnNames("menu_item_prices")).has("size_name")) {
    [rows] = await pool.query(`
      SELECT p.menu_item_id, p.size_name AS name
      FROM menu_item_prices p
      WHERE p.size_name <> ''
        AND NOT EXISTS (
          SELECT 1 FROM menu_item_prices b
          WHERE b.menu_item_id = p.menu_item_id AND b.size_name = ''
        )
      ORDER BY p.menu_item_id, p.sort_order, p.id
    `);
  } else if (await tableExists("menu_item_sizes")) {
    [rows] = await pool.query(`
      SELECT menu_item_id, TRIM(name) AS name
      FROM menu_item_sizes
      WHERE TRIM(name) <> ''
      ORDER BY menu_item_id, sort_order, id
    `);
  }

  const keptSizes = new Map();
  for (const row of rows) {
    if (!keptSizes.has(row.menu_item_id)) {
      keptSizes.set(row.menu_item_id, normalizeSizeName(row.name));
    }
  }

  return keptSizes;
};

// Legacy menu_item_ingredients -> menu_item_recipes. Unlinked rows are matched to stock by
// name, rows still without a stock item are dropped, and rows of other sizes
// than the kept one are dropped. Quantities are converted to the stock item's
// unit and repeats of a stock item summed. Copying only into an empty menu_item_recipes
// table keeps a re-run after a crash between the copy and the drop from
// doubling quantities.
const migrateLegacyMenuIngredients = async (keptSizes) => {
  if (!(await tableExists("menu_item_ingredients"))) return;

  const [[recipeCount]] = await pool.query("SELECT COUNT(*) AS total FROM menu_item_recipes");

  if (Number(recipeCount.total) === 0) {
    await runSafeMigration("ALTER TABLE menu_item_ingredients ADD COLUMN size_name VARCHAR(80) NULL AFTER stock_item_id");
    await pool.query(`
      UPDATE menu_item_ingredients mii
      JOIN stock_raw_items si ON si.name = mii.ingredient_name
      SET mii.stock_item_id = si.id
      WHERE mii.stock_item_id IS NULL
    `);

    const [rows] = await pool.query(`
      SELECT mii.menu_item_id, mii.stock_item_id, mii.size_name, mii.quantity,
             mii.unit, si.unit AS stock_unit, mii.sort_order, mii.note,
             mii.created_at, mii.updated_at
      FROM menu_item_ingredients mii
      LEFT JOIN stock_raw_items si ON si.id = mii.stock_item_id
      ORDER BY mii.id ASC
    `);
    const keptRows = rows.filter((row) => {
      const sizeName = normalizeSizeName(row.size_name);
      return (
        row.stock_item_id &&
        (!sizeName || sizeName === keptSizes.get(row.menu_item_id))
      );
    });

    if (keptRows.length < rows.length) {
      logger.warn(
        `Dropping ${rows.length - keptRows.length} recipe row(s) without a stock item or for a removed menu size while migrating to menu_item_recipes`
      );
    }

    if (keptRows.length) {
      await pool.query(
        `INSERT INTO menu_item_recipes
          (menu_item_id, stock_item_id, quantity, sort_order, note,
           created_at, updated_at)
         VALUES ?
         ON DUPLICATE KEY UPDATE quantity = ROUND(quantity + VALUES(quantity), 4)`,
        [
          keptRows.map((row) => [
            row.menu_item_id,
            row.stock_item_id,
            roundRecipeQuantity(
              convertRecipeQuantity(row.quantity, row.unit, row.stock_unit)
            ),
            row.sort_order,
            row.note,
            row.created_at,
            row.updated_at,
          ]),
        ]
      );
    }
  }

  await pool.query("DROP TABLE menu_item_ingredients");
};

// menu_item_recipes with a size_name column: rows of the kept size join the menu's
// recipe (summed into an existing row with the same unit), other sizes go.
const removeRecipeSizes = async (keptSizes) => {
  if (!(await getColumnNames("menu_item_recipes")).has("size_name")) return;

  await withTransaction(async (connection) => {
    const [sizeRows] = await connection.query(
      "SELECT * FROM menu_item_recipes WHERE size_name <> '' ORDER BY id ASC"
    );
    let summedRows = 0;

    for (const row of sizeRows) {
      if (normalizeSizeName(row.size_name) !== keptSizes.get(row.menu_item_id)) {
        continue;
      }

      const [[baseRow]] = await connection.query(
        `SELECT id, unit FROM menu_item_recipes
         WHERE menu_item_id = ? AND stock_item_id = ? AND size_name = ''`,
        [row.menu_item_id, row.stock_item_id]
      );

      if (!baseRow) {
        await connection.query("UPDATE menu_item_recipes SET size_name = '' WHERE id = ?", [row.id]);
      } else if (baseRow.unit === row.unit) {
        await connection.query(
          "UPDATE menu_item_recipes SET quantity = ROUND(quantity + ?, 4) WHERE id = ?",
          [row.quantity, baseRow.id]
        );
        summedRows += 1;
      }
    }

    const [deleted] = await connection.query("DELETE FROM menu_item_recipes WHERE size_name <> ''");
    if (deleted.affectedRows > summedRows) {
      logger.warn(
        `Dropping ${deleted.affectedRows - summedRows} recipe row(s) of removed menu sizes`
      );
    }
  });

  await pool.query(`
    ALTER TABLE menu_item_recipes
      DROP INDEX uniq_recipes_menu_size_stock,
      ADD UNIQUE KEY uniq_recipes_menu_stock (menu_item_id, stock_item_id),
      DROP COLUMN size_name
  `);
};

// Legacy prices lived on menu_items (single-price menus) and menu_item_sizes;
// they move into menu_item_prices, one row per menu (a sized menu keeps its
// first size). Copying only into an empty table keeps a re-run after a crash
// between the copy and the drops from duplicating rows.
const migrateLegacyMenuPrices = async () => {
  const hasMenuPrices = (await getColumnNames("menu_items")).has("regular_price");
  const hasSizesTable = await tableExists("menu_item_sizes");
  if (!hasMenuPrices && !hasSizesTable) return;

  const [[priceCount]] = await pool.query(
    "SELECT COUNT(*) AS total FROM menu_item_prices"
  );
  const priceColumns = PRICE_ROW_COLUMNS.replace(")", ", created_at, updated_at)");

  if (Number(priceCount.total) === 0) {
    if (hasSizesTable) {
      const sizeColumns = await getColumnNames("menu_item_sizes");
      const sizeColumn = (name) => (sizeColumns.has(name) ? `mis.${name}` : "0");

      await pool.query(`
        INSERT INTO menu_item_prices ${priceColumns}
        SELECT
          mis.menu_item_id, mis.price,
          ${hasMenuPrices ? "mi.online_price" : "NULL"},
          ${sizeColumn("hpp_cost")}, ${sizeColumn("gross_profit")},
          mis.created_at, mis.updated_at
        FROM menu_item_sizes mis
        JOIN menu_items mi ON mi.id = mis.menu_item_id
        WHERE TRIM(mis.name) <> ''
          AND NOT EXISTS (
            SELECT 1 FROM menu_item_sizes e
            WHERE e.menu_item_id = mis.menu_item_id
              AND TRIM(e.name) <> ''
              AND (e.sort_order < mis.sort_order
                OR (e.sort_order = mis.sort_order AND e.id < mis.id))
          )
      `);
    }

    if (hasMenuPrices) {
      await pool.query(`
        INSERT INTO menu_item_prices ${priceColumns}
        SELECT
          mi.id, mi.regular_price, mi.online_price,
          COALESCE(mi.hpp_cost, 0), COALESCE(mi.gross_profit, 0),
          mi.created_at, mi.updated_at
        FROM menu_items mi
        WHERE mi.regular_price IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM menu_item_prices mip WHERE mip.menu_item_id = mi.id
          )
      `);
    }
  }

  for (const column of ["regular_price", "online_price", "hpp_cost", "gross_profit"]) {
    await runSafeMigration(`ALTER TABLE menu_items DROP COLUMN ${column}`);
  }
  await pool.query("DROP TABLE IF EXISTS menu_item_sizes");
};

// menu_item_prices with one row per size ('' = single price) -> one row per menu.
const removePriceSizes = async (keptSizes) => {
  if (!(await getColumnNames("menu_item_prices")).has("size_name")) return;

  await withTransaction(async (connection) => {
    const [sizeRows] = await connection.query(
      "SELECT id, menu_item_id, size_name FROM menu_item_prices WHERE size_name <> '' ORDER BY sort_order, id"
    );
    const keptIds = [];
    const seenMenuIds = new Set();

    for (const row of sizeRows) {
      if (seenMenuIds.has(row.menu_item_id)) continue;
      if (normalizeSizeName(row.size_name) !== keptSizes.get(row.menu_item_id)) continue;

      seenMenuIds.add(row.menu_item_id);
      keptIds.push(row.id);
    }

    if (keptIds.length) {
      await connection.query(
        "UPDATE menu_item_prices SET size_name = '' WHERE id IN (?)",
        [keptIds]
      );
    }

    const [deleted] = await connection.query(
      "DELETE FROM menu_item_prices WHERE size_name <> ''"
    );
    if (deleted.affectedRows > 0) {
      logger.warn(`Dropping ${deleted.affectedRows} price row(s) of removed menu sizes`);
    }
  });

  await pool.query(`
    ALTER TABLE menu_item_prices
      DROP INDEX uniq_menu_item_prices_size,
      ADD UNIQUE KEY uniq_menu_item_prices_menu_item (menu_item_id),
      DROP COLUMN size_name,
      DROP COLUMN sort_order
  `);
};

// menu_item_recipes with a unit column: quantities move to the stock item's unit the same
// way stock deduction converted them (incompatible units keep the raw number),
// so stock movements and HPP stay the same. Each converted row also takes the
// stock unit, which keeps a re-run after a crash from converting it twice.
const removeRecipeUnits = async () => {
  if (!(await getColumnNames("menu_item_recipes")).has("unit")) return;

  await pool.query(
    "ALTER TABLE menu_item_recipes MODIFY COLUMN quantity DECIMAL(14,4) NOT NULL DEFAULT 0"
  );
  await withTransaction(async (connection) => {
    const [rows] = await connection.query(`
      SELECT r.id, r.quantity, r.unit, si.unit AS stock_unit
      FROM menu_item_recipes r
      JOIN stock_raw_items si ON si.id = r.stock_item_id
      WHERE r.unit <> si.unit
    `);

    for (const row of rows) {
      await connection.query(
        "UPDATE menu_item_recipes SET quantity = ?, unit = ? WHERE id = ?",
        [convertRecipeQuantity(row.quantity, row.unit, row.stock_unit), row.stock_unit, row.id]
      );
    }
  });
  await pool.query("ALTER TABLE menu_item_recipes DROP COLUMN unit");
};

// Recipe quantities become plain numbers so phpMyAdmin shows 8 instead of
// 8.0000 (values were stored with at most 4 decimals, so nothing is lost).
const useDoubleRecipeQuantities = async () => {
  const [[column]] = await pool.query("SHOW COLUMNS FROM menu_item_recipes LIKE 'quantity'");
  if (!column || /^double/i.test(column.Type)) return;

  await pool.query(
    "ALTER TABLE menu_item_recipes MODIFY COLUMN quantity DOUBLE NOT NULL DEFAULT 0"
  );
};

// Folds menu sizes away in recipes and prices. Recipes go first because the
// kept size of each menu is read from the price data that is collapsed last.
const removeMenuSizes = async () => {
  const keptSizes = await findKeptMenuSizes();

  await migrateLegacyMenuIngredients(keptSizes);
  await removeRecipeSizes(keptSizes);
  await migrateLegacyMenuPrices();
  await removePriceSizes(keptSizes);
};

const seedDefaultMenuIngredients = async () => {
  const menuNames = Object.keys(seedMenuIngredients);
  if (!menuNames.length) return;

  const stockNames = [
    ...new Set(
      Object.values(seedMenuIngredients)
        .flat()
        .map(([stockName]) => stockName)
    ),
  ];

  const [menuRows] = await pool.query(
    `SELECT id, name FROM menu_items
     WHERE name IN (${menuNames.map(() => "?").join(", ")})`,
    menuNames
  );
  const [stockRows] = await pool.query(
    `SELECT id, name FROM stock_raw_items
     WHERE name IN (${stockNames.map(() => "?").join(", ")})`,
    stockNames
  );

  const menuIdByName = new Map(menuRows.map((menu) => [menu.name, menu.id]));
  const stockIdByName = new Map(stockRows.map((stock) => [stock.name, stock.id]));

  for (const [menuName, ingredients] of Object.entries(seedMenuIngredients)) {
    const menuItemId = menuIdByName.get(menuName);
    if (!menuItemId) continue;

    const [[recipeCount]] = await pool.query(
      "SELECT COUNT(*) AS total FROM menu_item_recipes WHERE menu_item_id = ?",
      [menuItemId]
    );
    if (Number(recipeCount.total) > 0) continue;

    // Recipe rows need a stock item; seed entries whose stock is missing are skipped.
    const recipeRows = ingredients
      .map(([stockName, quantity], index) => [
        menuItemId,
        stockIdByName.get(stockName),
        quantity,
        index + 1,
      ])
      .filter(([, stockItemId]) => stockItemId);
    if (!recipeRows.length) continue;

    await pool.query(
      `INSERT IGNORE INTO menu_item_recipes
        (menu_item_id, stock_item_id, quantity, sort_order)
       VALUES ?`,
      [recipeRows]
    );
  }
};

const toSeedImagePath = (value) =>
  typeof value === "string" && value.startsWith("/uploads/") ? value : null;

// Default menus (prices, recipes) for a brand-new database. The boot runs this
// only when menu_items was just created, so menus the admin later edits or
// deletes are never touched again.
const seedDefaultMenuCatalog = async () => {
  const [categoryRows] = await pool.query(
    `SELECT id, name FROM categories
     WHERE name IN (${seedCategories.map(() => "?").join(", ")})`,
    seedCategories.map(([name]) => name)
  );
  const categoryIdByName = new Map(
    categoryRows.map((category) => [category.name, category.id])
  );

  for (const [categoryName, name, regularPrice, imagePath] of seedMenuCatalog) {
    const categoryId = categoryIdByName.get(categoryName);
    if (!categoryId) continue;

    const [existingRows] = await pool.query(
      "SELECT id FROM menu_items WHERE name = ? LIMIT 1",
      [name]
    );
    if (existingRows.length) continue;

    const [result] = await pool.query(
      `INSERT INTO menu_items
        (category_id, name, include_online_platform, image_path, is_available)
       VALUES (?, ?, FALSE, ?, TRUE)`,
      [categoryId, name, toSeedImagePath(imagePath)]
    );
    const financials = seedMenuFinancials[name] || { hppCost: 0, grossProfit: 0 };

    await pool.query(
      `INSERT INTO menu_item_prices ${PRICE_ROW_COLUMNS} VALUES (?)`,
      [
        toPriceRow(result.insertId, {
          regularPrice,
          hppCost: roundCurrency(financials.hppCost),
          grossProfit: roundCurrency(financials.grossProfit),
        }),
      ]
    );
  }

  await seedDefaultMenuIngredients();
};

module.exports = {
  removeMenuSizes,
  removeRecipeUnits,
  seedDefaultMenuCatalog,
  useDoubleRecipeQuantities,
};
