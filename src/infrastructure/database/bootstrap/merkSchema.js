// Merk of a purchase line, for both kinds of belanja (see shopping.nota): the
// same bahan or barang may be bought in another merk later, at another price.
//   merk                 the merk names, created from Tambah Belanja
//   items.merk_id        the merk a line was bought in (optional)
// COGS stays one moving average per item; the merk of each purchase shows
// which merk moved it. Runs after the purchase tables exist.
const ITEM_TABLES = [
  { prefix: "raw", items: "history_stock_raw_purchase_items" },
  { prefix: "supply", items: "history_stock_supply_purchase_items" },
];

const hasColumn = async (db, table, column) => {
  const [rows] = await db.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
    [table, column]
  );
  return rows.length > 0;
};

const ensureMerkSchema = async (db) => {
  await db.query(`CREATE TABLE IF NOT EXISTS merk (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(150) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`);
  for (const { prefix, items } of ITEM_TABLES) {
    if (!(await hasColumn(db, items, "merk_id"))) {
      await db.query(`ALTER TABLE ${items}
        ADD COLUMN merk_id INT UNSIGNED NULL AFTER item_name,
        ADD CONSTRAINT fk_${prefix}_purchase_items_merk
          FOREIGN KEY (merk_id) REFERENCES merk(id) ON DELETE SET NULL`);
    }
  }
};

module.exports = { ensureMerkSchema };
