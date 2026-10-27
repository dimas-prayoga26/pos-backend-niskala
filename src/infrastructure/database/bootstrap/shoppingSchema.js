const ensureShoppingSchema = async (db) => {
  // Purchase tables are named history_* (formerly stock_purchase*). RENAME
  // TABLE keeps their data, indexes and foreign keys.
  for (const [oldName, newName] of [
    ["stock_purchases", "history_stock_purchases"],
    ["stock_purchase_items", "history_stock_purchase_items"],
    ["stock_purchase_item_logs", "history_stock_purchase_item_logs"],
  ]) {
    const [[tables]] = await db.query(
      `SELECT
         SUM(table_name = ?) AS old_count,
         SUM(table_name = ?) AS new_count
       FROM information_schema.tables
       WHERE table_schema = DATABASE()`,
      [oldName, newName]
    );
    if (Number(tables.old_count) && !Number(tables.new_count)) {
      await db.query(`RENAME TABLE \`${oldName}\` TO \`${newName}\``);
    }
  }

  await db.query(`CREATE TABLE IF NOT EXISTS suplier (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(150) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`);
  await db.query(`CREATE TABLE IF NOT EXISTS history_stock_purchases (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    request_id VARCHAR(64) NOT NULL UNIQUE,
    payload_hash CHAR(64) NOT NULL,
    purchase_date DATE NOT NULL,
    suplier_id INT UNSIGNED NOT NULL,
    suplier_name VARCHAR(150) NOT NULL,
    payment_method VARCHAR(80) NOT NULL,
    note VARCHAR(500) NOT NULL DEFAULT '',
    total DECIMAL(14,2) NOT NULL,
    created_by INT UNSIGNED NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_stock_purchases_date (purchase_date, id),
    FOREIGN KEY (suplier_id) REFERENCES suplier(id) ON DELETE RESTRICT,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB`);
  await db.query(`CREATE TABLE IF NOT EXISTS history_stock_purchase_items (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    purchase_id INT UNSIGNED NOT NULL,
    stock_item_id INT UNSIGNED NULL,
    item_name VARCHAR(150) NOT NULL,
    quantity DECIMAL(12,3) NOT NULL,
    unit VARCHAR(30) NOT NULL,
    unit_price DECIMAL(14,2) NOT NULL,
    total DECIMAL(14,2) NOT NULL,
    stock_quantity DECIMAL(12,2) NOT NULL,
    stock_unit VARCHAR(30) NOT NULL,
    stock_unit_cost INT NOT NULL DEFAULT 0,
    stock_value_after DECIMAL(14,2) NOT NULL DEFAULT 0,
    FOREIGN KEY (purchase_id) REFERENCES history_stock_purchases(id) ON DELETE CASCADE,
    FOREIGN KEY (stock_item_id) REFERENCES stock_items(id) ON DELETE SET NULL
  ) ENGINE=InnoDB`);
  await db.query(`CREATE TABLE IF NOT EXISTS history_stock_purchase_item_logs (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    purchase_item_id INT UNSIGNED NULL,
    purchase_id INT UNSIGNED NULL,
    stock_item_id INT UNSIGNED NULL,
    item_name VARCHAR(150) NOT NULL,
    action VARCHAR(20) NOT NULL,
    old_data JSON NULL,
    new_data JSON NULL,
    user_id INT UNSIGNED NULL,
    user_name VARCHAR(150) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_stock_purchase_item_logs_item (stock_item_id, created_at),
    INDEX idx_stock_purchase_item_logs_purchase_item (purchase_item_id, created_at),
    FOREIGN KEY (purchase_item_id) REFERENCES history_stock_purchase_items(id) ON DELETE SET NULL,
    FOREIGN KEY (purchase_id) REFERENCES history_stock_purchases(id) ON DELETE SET NULL,
    FOREIGN KEY (stock_item_id) REFERENCES stock_items(id) ON DELETE SET NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB`);
  // unit_cost / stock_unit_cost were called average_cost / stock_average_cost;
  // rename before the ADD COLUMNs below so no empty duplicate is created.
  await db.query("ALTER TABLE stock_items RENAME COLUMN average_cost TO unit_cost").catch(() => {});
  await db.query("ALTER TABLE history_stock_purchase_items RENAME COLUMN stock_average_cost TO stock_unit_cost").catch(() => {});
  await db.query("ALTER TABLE stock_items ADD COLUMN unit_cost INT NOT NULL DEFAULT 0 AFTER minimum_stock").catch(() => {});
  await db.query("ALTER TABLE stock_items ADD COLUMN stock_value DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER unit_cost").catch(() => {});
  await db.query("ALTER TABLE history_stock_purchase_items ADD COLUMN stock_unit_cost INT NOT NULL DEFAULT 0 AFTER stock_unit").catch(() => {});
  await db.query("ALTER TABLE history_stock_purchase_items ADD COLUMN stock_value_after DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER stock_unit_cost").catch(() => {});
  // Average costs are whole rupiah (211, not 211.2500); converting the old
  // DECIMAL columns rounds half up. stock_value keeps the exact amount paid.
  for (const [table, column] of [
    ["stock_items", "unit_cost"],
    ["history_stock_purchase_items", "stock_unit_cost"],
  ]) {
    const [[info]] = await db.query(`SHOW COLUMNS FROM ${table} LIKE ?`, [column]);
    if (info && !/^int/i.test(info.Type)) {
      await db.query(`ALTER TABLE ${table} MODIFY COLUMN ${column} INT NOT NULL DEFAULT 0`);
    }
  }
  await db.query(`
    UPDATE stock_items si
    JOIN (
      SELECT stock_item_id, SUM(total) / NULLIF(SUM(stock_quantity), 0) AS unit_cost
      FROM history_stock_purchase_items
      WHERE stock_item_id IS NOT NULL
      GROUP BY stock_item_id
    ) purchase_costs ON purchase_costs.stock_item_id = si.id
    SET
      si.unit_cost = CASE
        WHEN si.unit_cost = 0 THEN ROUND(COALESCE(purchase_costs.unit_cost, 0))
        ELSE si.unit_cost
      END,
      si.stock_value = CASE
        WHEN si.stock_value = 0 THEN ROUND(GREATEST(si.stock, 0) * COALESCE(NULLIF(si.unit_cost, 0), purchase_costs.unit_cost, 0), 2)
        ELSE si.stock_value
      END
  `).catch(() => {});
};
module.exports = { ensureShoppingSchema };
