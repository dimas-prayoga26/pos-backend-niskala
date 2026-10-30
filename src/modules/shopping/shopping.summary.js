// The summary cards of the Belanja page (Area Widget Ringkasan) for a period
// (from/to, see shopping.nota dateRange):
// - Serapan Bahan Baku: the Grand Total of the posted belanja bahan baku;
// - Peralatan, Perlengkapan, Promosi and Lain-lain (Biaya Overhead
//   Operasional): what their barang cost on the posted belanja lainnya, line by
//   line (cost_total, with their share of ongkir/diskon/PPN), so a nota holding
//   two kategori is split between them, never counted twice;
// - Valuasi Aset: the current value of the active Peralatan, lifetime (no period).
const { pool } = require("../../infrastructure/database/pool");
const { dateRange } = require("./shopping.nota");

const SPENDING_CATEGORIES = { Peralatan: "peralatan", Perlengkapan: "perlengkapan", Promosi: "promosi", "Lain-lain": "lainLain" };

const createShoppingSummary = (db) => async ({ from, to } = {}) => {
  const period = dateRange({ from, to });
  const [[raw]] = await db.query(
    `SELECT COUNT(*) AS notas, COALESCE(SUM(p.total), 0) AS total
     FROM history_stock_raw_purchases p WHERE p.status = 'posted'${period.sql}`,
    period.params
  );
  const [supplyRows] = await db.query(
    `SELECT COALESCE(s.category, i.category) AS category, COUNT(DISTINCT p.id) AS notas, COALESCE(SUM(i.cost_total), 0) AS total
     FROM history_stock_supply_purchase_items i
     JOIN history_stock_supply_purchases p ON p.id = i.purchase_id
     LEFT JOIN stock_supply_items s ON s.id = i.supply_item_id
     WHERE p.status = 'posted'${period.sql}
     GROUP BY COALESCE(s.category, i.category)`,
    period.params
  );
  const [[assets]] = await db.query(
    `SELECT COUNT(*) AS items, COALESCE(SUM(stock_value), 0) AS value
     FROM stock_supply_items WHERE is_active = TRUE AND category = 'Peralatan'`
  );

  const summary = {
    period: { from: from || null, to: to || null },
    bahanBaku: { total: Number(raw.total), notas: Number(raw.notas) },
    ...Object.fromEntries(Object.values(SPENDING_CATEGORIES).map((key) => [key, { total: 0, notas: 0 }])),
    asetPeralatan: { value: Number(assets.value), items: Number(assets.items) },
  };
  supplyRows.forEach((row) => {
    const key = SPENDING_CATEGORIES[row.category];
    if (key) summary[key] = { total: Number(row.total), notas: Number(row.notas) };
  });
  return summary;
};

module.exports = { summary: createShoppingSummary(pool), createShoppingSummary };
