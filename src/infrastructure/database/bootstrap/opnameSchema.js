// Stock Opname (Modul 3): physical counts of bahan baku and bahan olahan,
// one row per bahan whose count differed from the system stock.
//   history_stock_raw_opnames   bahan baku (stock_raw_items)
//   history_stock_semi_opnames  bahan olahan (stock_semi_items)
// difference = system_stock - actual_stock (> 0 kurang, < 0 lebih) and cost
// the stock value it took away (< 0 for a selisih lebih): the Kehilangan
// Persediaan of the P&L, apart from HPP and Biaya Wastage. Runs after
// ensureSemiItemsSchema.
const OPNAME_TABLES = [
  { table: "history_stock_raw_opnames", itemColumn: "stock_item_id", items: "stock_raw_items" },
  { table: "history_stock_semi_opnames", itemColumn: "semi_item_id", items: "stock_semi_items" },
];

const ensureOpnameSchema = async (db) => {
  for (const { table, itemColumn, items } of OPNAME_TABLES) {
    await db.query(`CREATE TABLE IF NOT EXISTS ${table} (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      ${itemColumn} INT UNSIGNED NULL,
      item_name VARCHAR(150) NOT NULL,
      opname_date DATE NOT NULL,
      system_stock DECIMAL(12,2) NOT NULL,
      actual_stock DECIMAL(12,2) NOT NULL,
      difference DECIMAL(12,2) NOT NULL,
      unit VARCHAR(30) NOT NULL,
      unit_cost INT NOT NULL DEFAULT 0,
      cost DECIMAL(14,2) NOT NULL DEFAULT 0,
      note VARCHAR(255) NULL,
      user_id INT UNSIGNED NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_${table}_date (opname_date),
      INDEX idx_${table}_item (${itemColumn}, opname_date),
      CONSTRAINT fk_${table}_item
        FOREIGN KEY (${itemColumn}) REFERENCES ${items}(id) ON DELETE SET NULL,
      CONSTRAINT fk_${table}_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB`);
  }
};

module.exports = { ensureOpnameSchema };
