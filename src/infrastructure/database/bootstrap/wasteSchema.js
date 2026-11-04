// Buang (wastage, Modul 3): bahan baku thrown away and the bukti foto of
// every write-off. Bahan olahan keep theirs in history_stock_semi_wastes
// (semiItemsSchema), so this runs after ensureSemiItemsSchema.
//   history_stock_raw_wastes              bahan baku thrown away, valued at
//                                         stock_value / stock at that time
//   history_stock_raw_waste_attachments   photos of a bahan baku write-off
//   history_stock_semi_waste_attachments  photos of a bahan olahan one
// Photo files live in storage/waste-photos (private).
const ensureWasteSchema = async (db) => {
  await db.query(`CREATE TABLE IF NOT EXISTS history_stock_raw_wastes (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    stock_item_id INT UNSIGNED NULL,
    item_name VARCHAR(150) NOT NULL,
    waste_date DATE NOT NULL,
    quantity DECIMAL(12,2) NOT NULL,
    unit VARCHAR(30) NOT NULL,
    unit_cost INT NOT NULL DEFAULT 0,
    cost DECIMAL(14,2) NOT NULL DEFAULT 0,
    reason VARCHAR(30) NOT NULL,
    note VARCHAR(255) NULL,
    user_id INT UNSIGNED NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_history_stock_raw_wastes_date (waste_date),
    INDEX idx_history_stock_raw_wastes_item (stock_item_id, waste_date),
    CONSTRAINT fk_history_stock_raw_wastes_stock_item
      FOREIGN KEY (stock_item_id) REFERENCES stock_raw_items(id) ON DELETE SET NULL,
    CONSTRAINT fk_history_stock_raw_wastes_user
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB`);

  for (const [table, wastes] of [
    ["history_stock_raw_waste_attachments", "history_stock_raw_wastes"],
    ["history_stock_semi_waste_attachments", "history_stock_semi_wastes"],
  ]) {
    await db.query(`CREATE TABLE IF NOT EXISTS ${table} (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      waste_id INT UNSIGNED NOT NULL,
      file_name VARCHAR(100) NOT NULL UNIQUE,
      original_name VARCHAR(255) NOT NULL DEFAULT '',
      mime_type VARCHAR(50) NOT NULL,
      size_bytes INT UNSIGNED NOT NULL,
      uploaded_by INT UNSIGNED NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_${table}_waste (waste_id, id),
      CONSTRAINT fk_${table}_waste
        FOREIGN KEY (waste_id) REFERENCES ${wastes}(id) ON DELETE CASCADE,
      CONSTRAINT fk_${table}_user
        FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB`);
  }
};

module.exports = { ensureWasteSchema };
