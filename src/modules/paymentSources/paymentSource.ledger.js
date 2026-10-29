// The only code that changes a payment source's balance. Every change is one
// history_payment_source_mutations row (saldo masuk or saldo keluar, and the
// saldo after it), written in the caller's transaction.
const createError = require("http-errors");
const { roundCurrency } = require("../../shared/utils/money");

const REFERENCE_TYPES = {
  manual: "manual",
  purchase: "purchase",
  purchaseEdit: "purchase_edit",
  purchaseDelete: "purchase_delete",
  // Belanja perlengkapan (history_stock_supply_purchases).
  supplyPurchase: "supply_purchase",
  supplyPurchaseEdit: "supply_purchase_edit",
  supplyPurchaseDelete: "supply_purchase_delete",
};

// amount > 0 is saldo masuk, amount < 0 saldo keluar. The balance may go
// below zero: the money has already left, the saldo shows what to top up.
const postMutation = async (
  connection,
  { sourceId, amount, date, referenceType, referenceId = null, note = "", userId = null }
) => {
  const [[source]] = await connection.query(
    "SELECT id, name, balance FROM meta_data_payment_source WHERE id = ? FOR UPDATE",
    [sourceId]
  );
  if (!source) throw createError(404, "Sumber pembayaran tidak ditemukan.");

  const value = roundCurrency(amount);
  const balance = roundCurrency(Number(source.balance) + value);
  await connection.query("UPDATE meta_data_payment_source SET balance = ? WHERE id = ?", [balance, source.id]);
  const [result] = await connection.query(
    `INSERT INTO history_payment_source_mutations
      (payment_source_id, mutation_date, amount_in, amount_out, balance_after, reference_type, reference_id, note, user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      source.id,
      date,
      Math.max(value, 0),
      Math.max(-value, 0),
      balance,
      referenceType,
      referenceId,
      String(note || "").slice(0, 255),
      userId || null,
    ]
  );

  return { id: result.insertId, sourceId: source.id, sourceName: source.name, balance };
};

// The source a purchase was paid from, or null for purchases saved before
// payment sources existed (those never moved a balance). referenceType tells
// belanja bahan baku (purchase) from belanja perlengkapan (supply_purchase).
const findPurchaseSourceId = async (connection, purchaseId, referenceType = REFERENCE_TYPES.purchase) => {
  const [[row]] = await connection.query(
    `SELECT payment_source_id FROM history_payment_source_mutations
     WHERE reference_type = ? AND reference_id = ?
     ORDER BY id LIMIT 1`,
    [referenceType, purchaseId]
  );
  return row?.payment_source_id || null;
};

module.exports = { REFERENCE_TYPES, findPurchaseSourceId, postMutation };
