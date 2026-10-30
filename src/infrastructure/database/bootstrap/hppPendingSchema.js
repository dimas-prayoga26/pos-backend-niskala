// Modul 2, Penjualan & COGS: the HPP of a nota (orders.hpp_status) is
// "pending" while a bahan olahan line (a bahan setengah jadi such as Nasi,
// order_item_costs.is_pending) waits for the cost of the day's cooking, and
// "closed" once the day is closed (hpp_closed_at). Orders sold before keep the
// HPP frozen at their sale: they start closed. Each line says what it is
// (hpp_type: standar = bahan baku, olahan = bahan setengah jadi) and where its
// cost comes from (hpp_source: penjualan = the cost at the sale, dapur = the
// day's Daily Prep); a locked olahan line from penjualan is a fallback.
const columnsOf = async (db, table) => {
  const [rows] = await db.query(
    `SELECT column_name AS name FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ?`,
    [table]
  );
  return new Set(rows.map((row) => row.name));
};

const ensureHppPendingSchema = async (db) => {
  const orders = await columnsOf(db, "orders");
  if (!orders.has("hpp_status")) {
    await db.query(
      `ALTER TABLE orders
       ADD COLUMN hpp_status VARCHAR(10) NOT NULL DEFAULT 'closed' AFTER order_status,
       ADD INDEX idx_orders_hpp_status (hpp_status)`
    );
  }
  if (!orders.has("hpp_closed_at")) {
    await db.query("ALTER TABLE orders ADD COLUMN hpp_closed_at DATETIME NULL AFTER hpp_status");
  }

  const costs = await columnsOf(db, "order_item_costs");
  if (!costs.has("is_pending")) {
    await db.query("ALTER TABLE order_item_costs ADD COLUMN is_pending BOOLEAN NOT NULL DEFAULT FALSE AFTER cost");
  }
  if (!costs.has("hpp_type")) {
    await db.query("ALTER TABLE order_item_costs ADD COLUMN hpp_type VARCHAR(10) NOT NULL DEFAULT 'standar' AFTER cost");
    await db.query("UPDATE order_item_costs SET hpp_type = 'olahan' WHERE semi_item_id IS NOT NULL");
  }
  if (!costs.has("hpp_source")) {
    // Lines still pending get theirs at the next Daily Prep or day closing.
    await db.query("ALTER TABLE order_item_costs ADD COLUMN hpp_source VARCHAR(10) NOT NULL DEFAULT 'penjualan' AFTER hpp_type");
  }
};

module.exports = { ensureHppPendingSchema };
