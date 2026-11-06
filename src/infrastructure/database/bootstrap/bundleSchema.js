// Kategori Promo. A category marked is_bundle ("Kategori Promo") holds
// packages: menus made of other menus (menu_item_bundle_items) instead of
// bahan. Selling a package sells the recipes of its menus, each times its
// quantity. A menu used in a package cannot be deleted (RESTRICT); deleting
// the package removes its contents (CASCADE).
// A package may also hold choices (menu_item_bundle_choices): N menus of a
// category that the cashier picks when ordering; the picked menus of each
// sold package are kept in order_item_bundle_choices (per package).
const ensureBundleSchema = async (db) => {
  const [columns] = await db.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'categories' AND column_name = 'is_bundle'`
  );
  if (!columns.length) {
    await db.query("ALTER TABLE categories ADD COLUMN is_bundle BOOLEAN NOT NULL DEFAULT FALSE AFTER tax");
  }

  // A promo with a discount costs its menus' normal price less the percent
  // (e.g. 100% for a Google Maps review) instead of a fixed promo price.
  const [discountColumns] = await db.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'menu_item_prices' AND column_name = 'discount_percent'`
  );
  if (!discountColumns.length) {
    await db.query(
      "ALTER TABLE menu_item_prices ADD COLUMN discount_percent DECIMAL(5,2) NOT NULL DEFAULT 0 AFTER gross_profit"
    );
  }

  await db.query(`CREATE TABLE IF NOT EXISTS menu_item_bundle_items (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    bundle_menu_item_id INT UNSIGNED NOT NULL,
    menu_item_id INT UNSIGNED NOT NULL,
    quantity INT UNSIGNED NOT NULL DEFAULT 1,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_menu_item_bundle_items (bundle_menu_item_id, menu_item_id),
    INDEX idx_menu_item_bundle_items_menu_item_id (menu_item_id),
    CONSTRAINT fk_menu_item_bundle_items_bundle
      FOREIGN KEY (bundle_menu_item_id) REFERENCES menu_items(id) ON DELETE CASCADE,
    CONSTRAINT fk_menu_item_bundle_items_menu_item
      FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE RESTRICT
  ) ENGINE=InnoDB`);

  await db.query(`CREATE TABLE IF NOT EXISTS menu_item_bundle_choices (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    bundle_menu_item_id INT UNSIGNED NOT NULL,
    category_id INT UNSIGNED NOT NULL,
    quantity INT UNSIGNED NOT NULL DEFAULT 1,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_menu_item_bundle_choices (bundle_menu_item_id, category_id),
    INDEX idx_menu_item_bundle_choices_category_id (category_id),
    CONSTRAINT fk_menu_item_bundle_choices_bundle
      FOREIGN KEY (bundle_menu_item_id) REFERENCES menu_items(id) ON DELETE CASCADE,
    CONSTRAINT fk_menu_item_bundle_choices_category
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT
  ) ENGINE=InnoDB`);

  // The menus a choice offers (none: every menu of its category).
  await db.query(`CREATE TABLE IF NOT EXISTS menu_item_bundle_choice_menus (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    bundle_choice_id INT UNSIGNED NOT NULL,
    menu_item_id INT UNSIGNED NOT NULL,
    UNIQUE KEY uniq_menu_item_bundle_choice_menus (bundle_choice_id, menu_item_id),
    INDEX idx_menu_item_bundle_choice_menus_menu_item_id (menu_item_id),
    CONSTRAINT fk_menu_item_bundle_choice_menus_choice
      FOREIGN KEY (bundle_choice_id) REFERENCES menu_item_bundle_choices(id) ON DELETE CASCADE,
    CONSTRAINT fk_menu_item_bundle_choice_menus_menu_item
      FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE RESTRICT
  ) ENGINE=InnoDB`);

  await db.query(`CREATE TABLE IF NOT EXISTS order_item_bundle_choices (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    order_item_id INT UNSIGNED NOT NULL,
    menu_item_id INT UNSIGNED NULL,
    menu_item_name VARCHAR(150) NOT NULL,
    quantity INT UNSIGNED NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_order_item_bundle_choices_order_item_id (order_item_id),
    INDEX idx_order_item_bundle_choices_menu_item_id (menu_item_id),
    CONSTRAINT fk_order_item_bundle_choices_order_item
      FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE CASCADE,
    CONSTRAINT fk_order_item_bundle_choices_menu_item
      FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE SET NULL
  ) ENGINE=InnoDB`);
};

module.exports = { ensureBundleSchema };
