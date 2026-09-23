const ensureShoppingSchema = async (db) => {
  await db.query(`CREATE TABLE IF NOT EXISTS suplier (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(150) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`);
  await db.query(`CREATE TABLE IF NOT EXISTS stock_purchases (
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
  await db.query(`CREATE TABLE IF NOT EXISTS stock_purchase_items (
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
    stock_average_cost DECIMAL(14,4) NOT NULL DEFAULT 0,
    stock_value_after DECIMAL(14,2) NOT NULL DEFAULT 0,
    FOREIGN KEY (purchase_id) REFERENCES stock_purchases(id) ON DELETE CASCADE,
    FOREIGN KEY (stock_item_id) REFERENCES stock_items(id) ON DELETE SET NULL
  ) ENGINE=InnoDB`);
  await db.query("ALTER TABLE stock_items ADD COLUMN average_cost DECIMAL(14,4) NOT NULL DEFAULT 0 AFTER minimum_stock").catch(() => {});
  await db.query("ALTER TABLE stock_items ADD COLUMN stock_value DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER average_cost").catch(() => {});
  await db.query("ALTER TABLE stock_purchase_items ADD COLUMN stock_average_cost DECIMAL(14,4) NOT NULL DEFAULT 0 AFTER stock_unit").catch(() => {});
  await db.query("ALTER TABLE stock_purchase_items ADD COLUMN stock_value_after DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER stock_average_cost").catch(() => {});
  await db.query(`
    UPDATE stock_items si
    JOIN (
      SELECT stock_item_id, SUM(total) / NULLIF(SUM(stock_quantity), 0) AS average_cost
      FROM stock_purchase_items
      WHERE stock_item_id IS NOT NULL
      GROUP BY stock_item_id
    ) purchase_costs ON purchase_costs.stock_item_id = si.id
    SET
      si.average_cost = CASE
        WHEN si.average_cost = 0 THEN ROUND(COALESCE(purchase_costs.average_cost, 0), 4)
        ELSE si.average_cost
      END,
      si.stock_value = CASE
        WHEN si.stock_value = 0 THEN ROUND(GREATEST(si.stock, 0) * COALESCE(NULLIF(si.average_cost, 0), purchase_costs.average_cost, 0), 2)
        ELSE si.stock_value
      END
  `).catch(() => {});
};
module.exports = { ensureShoppingSchema };
