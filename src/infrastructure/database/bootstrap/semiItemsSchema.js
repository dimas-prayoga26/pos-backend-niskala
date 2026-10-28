// Bahan setengah jadi (stock_semi_items, e.g. Nasi from Beras, Sambal from
// Cabai) are counted in portions and cooked from bahan baku (stock_raw_items):
//   stock_semi_item_recipes            composition of one recipe (batch), in
//                                      each raw item's stock unit
//   stock_semi_item_productions        one row per cooking ("Catat Masak"):
//                                      the portions found by weighing the result
//   stock_semi_item_production_items   raw items used by that cooking, with the
//                                      unit cost at that time
//   stock_semi_item_menus              portions of a semi item in a menu's
//                                      recipe (bahan baku lines stay in recipes)
// Cooking moves stock from the raw items to the semi item; selling a menu then
// uses the semi item's portions like any other stock item.

// Before stock_semi_items existed (develop only, 2026-10-28) these items were
// stock_items rows with is_prepared = TRUE, with their composition and
// cookings in prepared_item_* tables, later renamed stock_item_*.
const LEGACY_TABLES = {
  productionItems: ["stock_item_production_items", "prepared_item_production_items"],
  productions: ["stock_item_productions", "prepared_item_productions"],
  recipes: ["stock_item_recipes", "prepared_item_recipes"],
};
const LEGACY_RAW_COLUMNS = ["is_prepared", "portion_size", "yield_quantity"];

const findTables = async (db, names) => {
  const [rows] = await db.query(
    `SELECT table_name AS name FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name IN (?)`,
    [names]
  );
  return new Set(rows.map((row) => row.name));
};

const findColumns = async (db, table) => {
  const [rows] = await db.query(
    `SELECT column_name AS name FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ?`,
    [table]
  );
  return new Set(rows.map((row) => row.name));
};

const inTransaction = async (db, work) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    await work(connection);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

// Moves the menu recipe lines of an old item id into stock_semi_item_menus.
const moveRecipeLines = async (connection, where, params, semiIdSql, semiParams = []) => {
  await connection.query(
    `INSERT IGNORE INTO stock_semi_item_menus
      (menu_item_id, semi_item_id, quantity, cost, sort_order, note, created_at)
     SELECT menu_item_id, ${semiIdSql}, quantity, cost, sort_order, note, created_at
     FROM recipes WHERE ${where}`,
    [...semiParams, ...params]
  );
  await connection.query(`DELETE FROM recipes WHERE ${where}`, params);
};

// Copies the legacy rows into stock_semi_items and stock_semi_item_*, points
// menu recipes and order costs at the new ids, then empties the legacy rows,
// all in one transaction so a crash never leaves them half moved.
const moveLegacyRows = (db, legacy, hasPreparedColumn) =>
  inTransaction(db, async (connection) => {
    const semiIdByOldId = new Map();
    if (hasPreparedColumn) {
      const [items] = await connection.query(
        "SELECT * FROM stock_raw_items WHERE is_prepared = TRUE ORDER BY id"
      );
      for (const item of items) {
        const [result] = await connection.query(
          `INSERT INTO stock_semi_items
            (name, category, unit, stock, minimum_stock, unit_cost, stock_value,
             portion_size, yield_quantity, is_active, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
          [
            item.name, item.category, item.unit, item.stock, item.minimum_stock,
            item.unit_cost, item.stock_value, item.portion_size || 0,
            item.yield_quantity || 0, item.is_active, item.created_at,
          ]
        );
        semiIdByOldId.set(item.id, result.insertId);
        await moveRecipeLines(connection, "stock_item_id = ?", [item.id], "?", [result.insertId]);
        await connection.query(
          "UPDATE order_item_costs SET stock_item_id = NULL, semi_item_id = ? WHERE stock_item_id = ?",
          [result.insertId, item.id]
        );
      }
    }

    if (legacy.recipes) {
      const [rows] = await connection.query(`SELECT * FROM ${legacy.recipes} ORDER BY id`);
      for (const row of rows) {
        const semiId = semiIdByOldId.get(row.prepared_item_id);
        if (!semiId) continue;
        await connection.query(
          `INSERT IGNORE INTO stock_semi_item_recipes
            (semi_item_id, stock_item_id, quantity, cost, sort_order, note, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [semiId, row.stock_item_id, row.quantity, row.cost, row.sort_order, row.note, row.created_at]
        );
      }
      await connection.query(`DELETE FROM ${legacy.recipes}`);
    }

    if (legacy.productions) {
      const [productions] = await connection.query(`SELECT * FROM ${legacy.productions} ORDER BY id`);
      const [usedItems] = legacy.productionItems
        ? await connection.query(`SELECT * FROM ${legacy.productionItems} ORDER BY id`)
        : [[]];
      for (const production of productions) {
        const [result] = await connection.query(
          `INSERT INTO stock_semi_item_productions
            (semi_item_id, item_name, batch_quantity, output_weight, portion_quantity,
             cost, unit_cost, note, produced_at, user_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            semiIdByOldId.get(production.prepared_item_id) || null,
            production.item_name, production.batch_quantity, production.output_weight,
            production.portion_quantity, production.cost, production.unit_cost,
            production.note, production.produced_at, production.user_id, production.created_at,
          ]
        );
        for (const used of usedItems.filter((row) => row.production_id === production.id)) {
          await connection.query(
            `INSERT INTO stock_semi_item_production_items
              (production_id, stock_item_id, item_name, quantity, unit, unit_cost, cost)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [result.insertId, used.stock_item_id, used.item_name, used.quantity, used.unit, used.unit_cost, used.cost]
          );
        }
      }
      if (legacy.productionItems) await connection.query(`DELETE FROM ${legacy.productionItems}`);
      await connection.query(`DELETE FROM ${legacy.productions}`);
    }

    if (semiIdByOldId.size) {
      await connection.query("DELETE FROM stock_raw_items WHERE id IN (?)", [[...semiIdByOldId.keys()]]);
    }
  });

// Moves bahan setengah jadi out of the legacy layout, then drops the legacy
// tables and stock_raw_items columns, which are empty by then.
const migrateLegacyPreparedItems = async (db) => {
  const existingTables = await findTables(db, Object.values(LEGACY_TABLES).flat());
  const rawColumns = await findColumns(db, "stock_raw_items");
  const hasPreparedColumn = rawColumns.has("is_prepared");
  if (!existingTables.size && !LEGACY_RAW_COLUMNS.some((column) => rawColumns.has(column))) return;

  const legacy = Object.fromEntries(
    Object.entries(LEGACY_TABLES).map(([key, names]) => [key, names.find((name) => existingTables.has(name))])
  );
  await moveLegacyRows(db, legacy, hasPreparedColumn);

  for (const name of Object.values(LEGACY_TABLES).flat()) {
    if (existingTables.has(name)) await db.query(`DROP TABLE ${name}`);
  }
  for (const column of LEGACY_RAW_COLUMNS) {
    if (rawColumns.has(column)) await db.query(`ALTER TABLE stock_raw_items DROP COLUMN ${column}`);
  }
};

// recipes briefly had semi_item_id (develop only, 2026-10-28). Its semi lines
// move to stock_semi_item_menus and recipes gets its original shape back.
const restoreRecipesTable = async (db) => {
  if (!(await findColumns(db, "recipes")).has("semi_item_id")) return;

  await inTransaction(db, (connection) =>
    moveRecipeLines(connection, "semi_item_id IS NOT NULL", [], "semi_item_id")
  );

  const ignoreMissing = () => {};
  await db.query("ALTER TABLE recipes DROP CONSTRAINT chk_recipes_one_item").catch(ignoreMissing);
  await db.query("ALTER TABLE recipes DROP FOREIGN KEY fk_recipes_semi_item").catch(ignoreMissing);
  await db.query("ALTER TABLE recipes DROP INDEX uniq_recipes_menu_semi").catch(ignoreMissing);
  await db.query("ALTER TABLE recipes DROP INDEX idx_recipes_semi_item_id").catch(ignoreMissing);
  await db.query("ALTER TABLE recipes DROP COLUMN semi_item_id");
  await db.query("ALTER TABLE recipes MODIFY COLUMN stock_item_id INT UNSIGNED NOT NULL");
};

const ensureSemiItemsSchema = async (db) => {
  await db.query(`CREATE TABLE IF NOT EXISTS stock_semi_item_recipes (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    semi_item_id INT UNSIGNED NOT NULL,
    stock_item_id INT UNSIGNED NOT NULL,
    quantity DOUBLE NOT NULL DEFAULT 0,
    cost INT NOT NULL DEFAULT 0,
    sort_order INT NOT NULL DEFAULT 0,
    note VARCHAR(255) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_stock_semi_item_recipes_item_stock (semi_item_id, stock_item_id),
    INDEX idx_stock_semi_item_recipes_stock_item_id (stock_item_id),
    CONSTRAINT fk_stock_semi_item_recipes_semi_item
      FOREIGN KEY (semi_item_id) REFERENCES stock_semi_items(id) ON DELETE CASCADE,
    CONSTRAINT fk_stock_semi_item_recipes_stock_item
      FOREIGN KEY (stock_item_id) REFERENCES stock_raw_items(id) ON DELETE RESTRICT
  ) ENGINE=InnoDB`);

  await db.query(`CREATE TABLE IF NOT EXISTS stock_semi_item_productions (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    semi_item_id INT UNSIGNED NULL,
    item_name VARCHAR(150) NOT NULL,
    batch_quantity DOUBLE NOT NULL,
    output_weight DOUBLE NULL,
    portion_quantity DECIMAL(12,2) NOT NULL,
    cost DECIMAL(14,2) NOT NULL DEFAULT 0,
    unit_cost INT NOT NULL DEFAULT 0,
    note VARCHAR(255) NULL,
    produced_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    user_id INT UNSIGNED NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_stock_semi_item_productions_item (semi_item_id, produced_at),
    CONSTRAINT fk_stock_semi_item_productions_semi_item
      FOREIGN KEY (semi_item_id) REFERENCES stock_semi_items(id) ON DELETE SET NULL,
    CONSTRAINT fk_stock_semi_item_productions_user
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB`);

  await db.query(`CREATE TABLE IF NOT EXISTS stock_semi_item_production_items (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    production_id INT UNSIGNED NOT NULL,
    stock_item_id INT UNSIGNED NULL,
    item_name VARCHAR(150) NOT NULL,
    quantity DOUBLE NOT NULL,
    unit VARCHAR(30) NOT NULL,
    unit_cost INT NOT NULL DEFAULT 0,
    cost DECIMAL(14,2) NOT NULL DEFAULT 0,
    INDEX idx_stock_semi_item_production_items_stock_item (stock_item_id),
    CONSTRAINT fk_stock_semi_item_production_items_production
      FOREIGN KEY (production_id) REFERENCES stock_semi_item_productions(id) ON DELETE CASCADE,
    CONSTRAINT fk_stock_semi_item_production_items_stock_item
      FOREIGN KEY (stock_item_id) REFERENCES stock_raw_items(id) ON DELETE SET NULL
  ) ENGINE=InnoDB`);

  // Portions of a semi item per menu, the bahan setengah jadi side of recipes.
  // sort_order shares one sequence with the menu's recipes rows.
  await db.query(`CREATE TABLE IF NOT EXISTS stock_semi_item_menus (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    menu_item_id INT UNSIGNED NOT NULL,
    semi_item_id INT UNSIGNED NOT NULL,
    quantity DOUBLE NOT NULL DEFAULT 0,
    cost INT NOT NULL DEFAULT 0,
    sort_order INT NOT NULL DEFAULT 0,
    note VARCHAR(255) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_stock_semi_item_menus_menu_semi (menu_item_id, semi_item_id),
    INDEX idx_stock_semi_item_menus_semi_item_id (semi_item_id),
    CONSTRAINT fk_stock_semi_item_menus_menu_item
      FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE CASCADE,
    CONSTRAINT fk_stock_semi_item_menus_semi_item
      FOREIGN KEY (semi_item_id) REFERENCES stock_semi_items(id) ON DELETE RESTRICT
  ) ENGINE=InnoDB`);

  await restoreRecipesTable(db);
  await migrateLegacyPreparedItems(db);
};

module.exports = { ensureSemiItemsSchema };
