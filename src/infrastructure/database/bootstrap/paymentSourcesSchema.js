// Payment sources (sumber pembayaran) and their balance (saldo):
//   meta_data_payment_source          Kasir (Tunai), Rekening Penjualan,
//                                     Niskala, ...; balance is the current saldo
//   history_payment_source_mutations  every change of a balance: saldo masuk
//                                     (amount_in), saldo keluar (amount_out) and
//                                     the saldo after it (balance_after)
// A purchase paid from a source posts its total as saldo keluar; editing or
// deleting its items posts the difference. See SHOPPING.md.
const SEED_SOURCES = ["Kasir (Tunai)", "Rekening Penjualan", "Niskala"];

const ensurePaymentSourcesSchema = async (db) => {
  await db.query(`CREATE TABLE IF NOT EXISTS meta_data_payment_source (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    balance DECIMAL(14,2) NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INT UNSIGNED NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`);
  await db.query(`CREATE TABLE IF NOT EXISTS history_payment_source_mutations (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    payment_source_id INT UNSIGNED NOT NULL,
    mutation_date DATE NOT NULL,
    amount_in DECIMAL(14,2) NOT NULL DEFAULT 0,
    amount_out DECIMAL(14,2) NOT NULL DEFAULT 0,
    balance_after DECIMAL(14,2) NOT NULL,
    reference_type VARCHAR(30) NOT NULL,
    reference_id INT UNSIGNED NULL,
    note VARCHAR(255) NOT NULL DEFAULT '',
    user_id INT UNSIGNED NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_payment_source_mutations_source (payment_source_id, id),
    INDEX idx_payment_source_mutations_reference (reference_type, reference_id),
    FOREIGN KEY (payment_source_id) REFERENCES meta_data_payment_source(id) ON DELETE RESTRICT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB`);

  // Seeded once, so renamed or deactivated sources are not created again.
  const [[{ total }]] = await db.query("SELECT COUNT(*) AS total FROM meta_data_payment_source");
  if (!Number(total)) {
    await db.query("INSERT IGNORE INTO meta_data_payment_source (name, sort_order) VALUES ?", [
      SEED_SOURCES.map((name, index) => [name, index + 1]),
    ]);
  }
};

module.exports = { ensurePaymentSourcesSchema };
