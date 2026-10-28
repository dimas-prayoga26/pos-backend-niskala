// Prepared items (bahan olahan, e.g. Nasi from Beras, Sambal from Cabai, ...)
// are stock_items rows with is_prepared = TRUE, counted in portions:
//   prepared_item_recipes            composition of one recipe (batch), in each
//                                    raw item's stock unit
//   prepared_item_productions        one row per cooking ("Catat Masak"): the
//                                    portions found by weighing the result
//   prepared_item_production_items   raw items used by that cooking, with the
//                                    unit cost at that time
// Cooking moves stock from the raw items to the prepared item; selling a menu
// then uses the prepared item's portions like any other stock item.
const ensurePreparedItemsSchema = async (db) => {
  const ignoreExisting = () => {};

  await db.query("ALTER TABLE stock_items ADD COLUMN is_prepared BOOLEAN NOT NULL DEFAULT FALSE AFTER is_unlimited").catch(ignoreExisting);
  // Weight (gr/ml) of one portion of the cooked result; set once per item.
  await db.query("ALTER TABLE stock_items ADD COLUMN portion_size DOUBLE NOT NULL DEFAULT 0 AFTER is_prepared").catch(ignoreExisting);
  // Portions per recipe found by the latest cooking (0 = never cooked).
  await db.query("ALTER TABLE stock_items ADD COLUMN yield_quantity DOUBLE NOT NULL DEFAULT 0 AFTER portion_size").catch(ignoreExisting);
  await db.query("ALTER TABLE stock_items ALTER COLUMN yield_quantity SET DEFAULT 0");

  await db.query(`CREATE TABLE IF NOT EXISTS prepared_item_recipes (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    prepared_item_id INT UNSIGNED NOT NULL,
    stock_item_id INT UNSIGNED NOT NULL,
    quantity DOUBLE NOT NULL DEFAULT 0,
    cost INT NOT NULL DEFAULT 0,
    sort_order INT NOT NULL DEFAULT 0,
    note VARCHAR(255) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_prepared_item_recipes_item_stock (prepared_item_id, stock_item_id),
    INDEX idx_prepared_item_recipes_stock_item_id (stock_item_id),
    CONSTRAINT fk_prepared_item_recipes_prepared_item
      FOREIGN KEY (prepared_item_id) REFERENCES stock_items(id) ON DELETE CASCADE,
    CONSTRAINT fk_prepared_item_recipes_stock_item
      FOREIGN KEY (stock_item_id) REFERENCES stock_items(id) ON DELETE RESTRICT
  ) ENGINE=InnoDB`);

  await db.query(`CREATE TABLE IF NOT EXISTS prepared_item_productions (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    prepared_item_id INT UNSIGNED NULL,
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
    INDEX idx_prepared_item_productions_item (prepared_item_id, produced_at),
    CONSTRAINT fk_prepared_item_productions_prepared_item
      FOREIGN KEY (prepared_item_id) REFERENCES stock_items(id) ON DELETE SET NULL,
    CONSTRAINT fk_prepared_item_productions_user
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB`);

  await db.query(`CREATE TABLE IF NOT EXISTS prepared_item_production_items (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    production_id INT UNSIGNED NOT NULL,
    stock_item_id INT UNSIGNED NULL,
    item_name VARCHAR(150) NOT NULL,
    quantity DOUBLE NOT NULL,
    unit VARCHAR(30) NOT NULL,
    unit_cost INT NOT NULL DEFAULT 0,
    cost DECIMAL(14,2) NOT NULL DEFAULT 0,
    INDEX idx_prepared_item_production_items_stock_item (stock_item_id),
    CONSTRAINT fk_prepared_item_production_items_production
      FOREIGN KEY (production_id) REFERENCES prepared_item_productions(id) ON DELETE CASCADE,
    CONSTRAINT fk_prepared_item_production_items_stock_item
      FOREIGN KEY (stock_item_id) REFERENCES stock_items(id) ON DELETE SET NULL
  ) ENGINE=InnoDB`);
};

module.exports = { ensurePreparedItemsSchema };
