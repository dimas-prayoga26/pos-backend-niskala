// Belanja "Lainnya" (peralatan, perlengkapan, promosi, lain-lain; formerly
// called perlengkapan, tables stay stock_supply_*): the same nota as
// belanja bahan baku (tanggal, toko, sumber pembayaran, bukti nota, footer)
// from the same "Tambah Bahan Belanjaan" form, but the items are
// stock_supply_items. It runs through the same nota engine (shopping.nota):
// stock and moving average cost work like bahan baku, they never reach
// recipes or HPP, and posting moves saldo keluar (supply_purchase).
const createError = require("http-errors");
const { pool } = require("../../infrastructure/database/pool");
const { REFERENCE_TYPES } = require("../paymentSources/paymentSource.ledger");
const { RECEIPT_TARGETS } = require("./shopping.attachments");
const { createNotaEngine, dateRange, itemFilter } = require("./shopping.nota");
const { DEFAULT_SUPPLY_UNIT, SUPPLY_CATEGORIES } = require("../stock/supply.repository");
const { clean, normalizeSupplyPurchase } = require("./shopping.validation");

const PAGE_SIZE = 10;

const snapshotItem = row => ({
  id: row.id,
  purchaseId: row.purchase_id,
  supplyItemId: row.supply_item_id,
  itemName: row.item_name,
  category: row.category,
  quantity: Number(row.quantity),
  unit: row.unit,
  unitPrice: Number(row.unit_price),
  total: Number(row.total),
  stockQuantity: Number(row.stock_quantity),
  stockUnit: row.stock_unit,
  stockAverageCost: Number(row.stock_unit_cost || 0),
  stockValueAfter: Number(row.stock_value_after || 0),
});

// A name is either bahan baku/setengah jadi or barang lainnya, never both.
const checkNewItem = async (connection, { itemName }) => {
  const name = clean(itemName, 150, "Nama barang");
  const [rawRows] = await connection.query(
    "SELECT id FROM stock_raw_items WHERE name = ? UNION ALL SELECT id FROM stock_semi_items WHERE name = ?",
    [name, name]
  );
  if (rawRows.length) throw createError(400, `${name} sudah terdaftar sebagai bahan baku. Pilih Jenis Belanja Bahan Baku.`);
  const [[existing]] = await connection.query("SELECT is_active FROM stock_supply_items WHERE name = ?", [name]);
  if (existing && !existing.is_active) throw createError(409, `${name} sudah ada tetapi tidak aktif.`);
};

const SUPPLY_NOTA = {
  kind: "supply",
  label: "belanja lainnya",
  purchases: "history_stock_supply_purchases",
  items: "history_stock_supply_purchase_items",
  attachments: RECEIPT_TARGETS.supply.attachments,
  attachmentUrl: RECEIPT_TARGETS.supply.url,
  stockTable: "stock_supply_items",
  itemFk: "supply_item_id",
  itemIdKey: "supplyItemId",
  referenceTypes: {
    purchase: REFERENCE_TYPES.supplyPurchase,
    edit: REFERENCE_TYPES.supplyPurchaseEdit,
    delete: REFERENCE_TYPES.supplyPurchaseDelete,
  },
  normalize: normalizeSupplyPurchase,
  ledgerNote: (id, supplierName) => `Belanja lainnya #${id} - ${supplierName}`,
  missingUnitMessage: name => `Satuan ${name} di Stok → Lainnya kosong padahal stoknya tidak 0.`,
  unlinkedMessage: "Item belanja ini tidak terhubung ke barang lainnya.",
  stockMissingMessage: "Barang lainnya tidak ditemukan.",
  // The form asks no unit: a line takes its item's unit, a new item pcs.
  defaultUnit: DEFAULT_SUPPLY_UNIT,
  // The Belanja tabs (Peralatan, Perlengkapan, Promosi, Lain-lain).
  categories: SUPPLY_CATEGORIES,
  checkNewItem,
  // A line keeps the category of its item; a new name brings its own.
  lineCategory: (item, stock) => (stock ? stock.category : item.category),
  createItem: async (connection, line) => {
    await checkNewItem(connection, { itemName: line.item_name });
    await connection.query(
      `INSERT INTO stock_supply_items (name, category, unit, stock, minimum_stock)
       VALUES (?, ?, '', 0, 0) ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
      [line.item_name, line.category]
    );
    const [[row]] = await connection.query("SELECT id FROM stock_supply_items WHERE name = ?", [line.item_name]);
    return row.id;
  },
  afterStock: async () => {},
  snapshotLine: snapshotItem,
};

const createSupplyShoppingService = (db, { receiptDir } = {}) => {
  const nota = createNotaEngine(db, { ...SUPPLY_NOTA, receiptDir });

  // Same shape as the bahan baku history (shopping.service list), so the
  // dashboard shows both with the same table: one group per item, its
  // purchases newest first. They have no activity log. category (the Belanja
  // tabs Peralatan, Perlengkapan, Promosi, Lain-lain) keeps the items of one
  // kategori: the item's current one, else the one saved on the line.
  // itemId keeps one barang: its detail opened from a line of the Per Nota history.
  // from/to keep a period (dateRange).
  const list = async ({ page = 1, search = "", category = "", itemId = "", from, to } = {}) => {
    page = Math.max(1, Math.floor(Number(page) || 1));
    const keyword = `%${String(search).slice(0, 150)}%`;
    const supplyItemId = itemFilter(itemId);
    const period = dateRange({ from, to });
    if (category && !SUPPLY_CATEGORIES.includes(category)) {
      throw createError(400, `Kategori harus ${SUPPLY_CATEGORIES.join(", ")}.`);
    }
    const [rows] = await db.query(
      `SELECT i.*, p.purchase_date, p.suplier_name, p.payment_method, p.note,
              s.stock, s.unit AS current_unit, s.unit_cost, s.stock_value, s.category AS current_category
       FROM history_stock_supply_purchase_items i
       JOIN history_stock_supply_purchases p ON p.id = i.purchase_id
       LEFT JOIN stock_supply_items s ON s.id = i.supply_item_id
       WHERE p.status = 'posted' AND (p.suplier_name LIKE ? OR i.item_name LIKE ? OR i.category LIKE ?)
         ${category ? "AND COALESCE(s.category, i.category) = ?" : ""}
         ${supplyItemId ? "AND i.supply_item_id = ?" : ""}${period.sql}
       ORDER BY i.item_name ASC, p.purchase_date DESC, p.id DESC, i.id DESC`,
      [keyword, keyword, keyword, ...(category ? [category] : []), ...(supplyItemId ? [supplyItemId] : []), ...period.params]
    );
    const attachmentsByPurchase = new Map();
    const purchaseIds = [...new Set(rows.map(row => row.purchase_id))];
    if (purchaseIds.length) {
      const [attachments] = await db.query(
        `SELECT id, purchase_id, original_name, created_at FROM history_stock_supply_purchase_attachments
         WHERE purchase_id IN (${purchaseIds.map(() => "?").join(",")}) ORDER BY id`,
        purchaseIds
      );
      attachments.forEach(attachment => {
        const list = attachmentsByPurchase.get(attachment.purchase_id) || [];
        list.push({
          id: attachment.id,
          url: RECEIPT_TARGETS.supply.url(attachment.id),
          name: attachment.original_name,
          createdAt: attachment.created_at,
        });
        attachmentsByPurchase.set(attachment.purchase_id, list);
      });
    }

    const groups = new Map();
    rows.forEach(row => {
      const key = row.supply_item_id ? `supply:${row.supply_item_id}` : `name:${row.item_name.toLowerCase()}`;
      if (!groups.has(key)) {
        groups.set(key, {
          stockItemId: row.supply_item_id,
          itemName: row.item_name,
          category: row.current_category || row.category,
          stock: row.stock == null ? null : Number(row.stock),
          stockUnit: row.current_unit || row.stock_unit,
          averageCost: Number(row.unit_cost || 0),
          stockValue: Number(row.stock_value || 0),
          purchaseCount: 0,
          histories: [],
          logs: [],
        });
      }
      const group = groups.get(key);
      group.purchaseCount += 1;
      group.histories.push({
        ...snapshotItem(row),
        costTotal: Number(row.cost_total ?? row.total),
        purchaseDate: row.purchase_date,
        supplierName: row.suplier_name,
        paymentMethod: row.payment_method,
        note: row.note || "",
        attachments: attachmentsByPurchase.get(row.purchase_id) || [],
      });
    });
    const itemGroups = [...groups.values()];

    return {
      itemGroups: itemGroups.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
      groupTotal: itemGroups.length,
      page,
    };
  };

  return {
    save: nota.create,
    updateDraft: nota.updateDraft,
    removeDraft: nota.removeDraft,
    listDrafts: nota.listDrafts,
    listNotas: nota.listPosted,
    updateItem: nota.updateItem,
    deleteItem: nota.deleteItem,
    list,
  };
};

module.exports = { ...createSupplyShoppingService(pool), createSupplyShoppingService };
