// Nota footer and drafts for both kinds of belanja (see shopping.nota):
//   status             draft (moves nothing yet) or posted
//   payment_source_id  the source the grand total is taken from when posted
//   subtotal, shipping_cost, discount_type/value/amount, tax_percent/amount
//                      Ringkasan: total = subtotal - discount + tax + ongkir
//   posted_at/by       who posted (approved) the nota
//   items.cost_total   the line's amount plus its share of ongkir/PPN minus
//                      diskon; this is what enters stock and COGS
// Runs after the payment source and perlengkapan tables exist.
const NOTA_TABLES = [
  {
    prefix: "raw",
    purchases: "history_stock_raw_purchases",
    items: "history_stock_raw_purchase_items",
    referenceType: "purchase",
  },
  {
    prefix: "supply",
    purchases: "history_stock_supply_purchases",
    items: "history_stock_supply_purchase_items",
    referenceType: "supply_purchase",
  },
];

const columnsOf = async (db, table) => {
  const [rows] = await db.query(
    `SELECT column_name AS name FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ?`,
    [table]
  );
  return new Set(rows.map((row) => row.name));
};

const ensureNotaSchema = async (db) => {
  for (const { prefix, purchases, items, referenceType } of NOTA_TABLES) {
    // One ALTER (atomic), so the one-time backfill below runs exactly once.
    if (!(await columnsOf(db, purchases)).has("subtotal")) {
      await db.query(`ALTER TABLE ${purchases}
        ADD COLUMN payment_source_id INT UNSIGNED NULL AFTER payment_method,
        ADD COLUMN subtotal DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER note,
        ADD COLUMN shipping_cost DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER subtotal,
        ADD COLUMN discount_type VARCHAR(10) NOT NULL DEFAULT 'amount' AFTER shipping_cost,
        ADD COLUMN discount_value DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER discount_type,
        ADD COLUMN discount_amount DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER discount_value,
        ADD COLUMN tax_percent DECIMAL(5,2) NOT NULL DEFAULT 0 AFTER discount_amount,
        ADD COLUMN tax_amount DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER tax_percent,
        ADD COLUMN status VARCHAR(10) NOT NULL DEFAULT 'posted' AFTER total,
        ADD COLUMN posted_at TIMESTAMP NULL AFTER created_at,
        ADD COLUMN posted_by INT UNSIGNED NULL AFTER posted_at,
        ADD INDEX idx_${prefix}_purchases_status (status, purchase_date, id),
        ADD CONSTRAINT fk_${prefix}_purchases_payment_source
          FOREIGN KEY (payment_source_id) REFERENCES meta_data_payment_source(id) ON DELETE SET NULL,
        ADD CONSTRAINT fk_${prefix}_purchases_posted_by
          FOREIGN KEY (posted_by) REFERENCES users(id) ON DELETE SET NULL`);
      // Notas saved before had no footer and were posted when saved.
      await db.query(`UPDATE ${purchases} SET subtotal = total, posted_at = created_at, posted_by = created_by`);
      await db.query(
        `UPDATE ${purchases} p
         JOIN history_payment_source_mutations m ON m.reference_type = ? AND m.reference_id = p.id
         SET p.payment_source_id = m.payment_source_id`,
        [referenceType]
      );
    }
    if (!(await columnsOf(db, items)).has("cost_total")) {
      await db.query(`ALTER TABLE ${items} ADD COLUMN cost_total DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER total`);
      await db.query(`UPDATE ${items} SET cost_total = total`);
    }
  }
};

module.exports = { ensureNotaSchema };
