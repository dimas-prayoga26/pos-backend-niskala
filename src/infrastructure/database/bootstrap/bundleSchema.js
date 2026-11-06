// Kategori Promo. A category marked is_bundle ("Kategori Promo") holds
// packages: menus made of other menus (menu_item_bundle_items) instead of
// bahan. Selling a package sells the recipes of its menus, each times its
// quantity. A menu used in a package cannot be deleted (RESTRICT); deleting
// the package removes its contents (CASCADE).
const ensureBundleSchema = async (db) => {
  const [columns] = await db.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'categories' AND column_name = 'is_bundle'`
  );
  if (!columns.length) {
    await db.query("ALTER TABLE categories ADD COLUMN is_bundle BOOLEAN NOT NULL DEFAULT FALSE AFTER tax");
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
};

module.exports = { ensureBundleSchema };
