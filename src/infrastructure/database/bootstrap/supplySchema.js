// Perlengkapan: things bought that are not bahan baku (peralatan, operasional,
// promosi). They are stocked like bahan baku but never used by recipes, so
// they never reach HPP.
//   stock_supply_items                         the items and their stock/value
//   history_stock_supply_purchases (+ _items)  belanja perlengkapan; the same
//                                              nota as belanja bahan baku
//   history_stock_supply_purchase_attachments  bukti nota photos
// Purchases are created from the same "Tambah Bahan Belanjaan" form
// (Jenis Belanja: Perlengkapan). See SHOPPING.md.
const ensureSupplySchema = async (db) => {
  await db.query(`CREATE TABLE IF NOT EXISTS stock_supply_items (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(150) NOT NULL UNIQUE,
    category VARCHAR(30) NOT NULL,
    unit VARCHAR(30) NOT NULL DEFAULT '',
    stock DECIMAL(12,2) NOT NULL DEFAULT 0,
    minimum_stock DECIMAL(12,2) NOT NULL DEFAULT 0,
    unit_cost INT NOT NULL DEFAULT 0,
    stock_value DECIMAL(14,2) NOT NULL DEFAULT 0,
    supplier VARCHAR(150) NULL,
    is_unlimited BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_stock_supply_items_category (category, name)
  ) ENGINE=InnoDB`);
  await db.query(`CREATE TABLE IF NOT EXISTS history_stock_supply_purchases (
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
    INDEX idx_supply_purchases_date (purchase_date, id),
    FOREIGN KEY (suplier_id) REFERENCES suplier(id) ON DELETE RESTRICT,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB`);
  await db.query(`CREATE TABLE IF NOT EXISTS history_stock_supply_purchase_items (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    purchase_id INT UNSIGNED NOT NULL,
    supply_item_id INT UNSIGNED NULL,
    item_name VARCHAR(150) NOT NULL,
    category VARCHAR(30) NOT NULL,
    quantity DECIMAL(12,3) NOT NULL,
    unit VARCHAR(30) NOT NULL,
    unit_price DECIMAL(14,2) NOT NULL,
    total DECIMAL(14,2) NOT NULL,
    stock_quantity DECIMAL(12,2) NOT NULL,
    stock_unit VARCHAR(30) NOT NULL,
    stock_unit_cost INT NOT NULL DEFAULT 0,
    stock_value_after DECIMAL(14,2) NOT NULL DEFAULT 0,
    INDEX idx_supply_purchase_items_item (supply_item_id),
    FOREIGN KEY (purchase_id) REFERENCES history_stock_supply_purchases(id) ON DELETE CASCADE,
    FOREIGN KEY (supply_item_id) REFERENCES stock_supply_items(id) ON DELETE SET NULL
  ) ENGINE=InnoDB`);
  await db.query(`CREATE TABLE IF NOT EXISTS history_stock_supply_purchase_attachments (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    purchase_id INT UNSIGNED NOT NULL,
    file_name VARCHAR(100) NOT NULL UNIQUE,
    original_name VARCHAR(255) NOT NULL DEFAULT '',
    mime_type VARCHAR(50) NOT NULL,
    size_bytes INT UNSIGNED NOT NULL,
    uploaded_by INT UNSIGNED NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_supply_purchase_attachments_purchase (purchase_id, id),
    FOREIGN KEY (purchase_id) REFERENCES history_stock_supply_purchases(id) ON DELETE CASCADE,
    FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB`);
};

module.exports = { ensureSupplySchema };
