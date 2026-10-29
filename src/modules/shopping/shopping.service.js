// Belanja bahan baku: notas whose items are stock_raw_items. Saving, posting,
// drafts and line edits run through the nota engine (shopping.nota): posting
// creates missing items, raises stock, recomputes the moving average cost and
// the menu HPP, and posts the grand total as saldo keluar. request_id makes
// retries idempotent; see SHOPPING.md for the business rules.
const createError = require("http-errors");
const { pool } = require("../../infrastructure/database/pool");
const { refreshMenuCosts } = require("../menu/menu.costs");
const { REFERENCE_TYPES } = require("../paymentSources/paymentSource.ledger");
const { RECEIPT_TARGETS, attachmentUrl } = require("./shopping.attachments");
const { actor, createNotaEngine, dateRange, itemFilter } = require("./shopping.nota");
const { clean, normalizePurchase, number } = require("./shopping.validation");

const parseJson = value => {
  if (!value) return null;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return null; }
};
const snapshotItem = row => ({
  id: row.id,
  purchaseId: row.purchase_id,
  stockItemId: row.stock_item_id,
  itemName: row.item_name,
  quantity: Number(row.quantity),
  unit: row.unit,
  unitPrice: Number(row.unit_price),
  total: Number(row.total),
  stockQuantity: Number(row.stock_quantity),
  stockUnit: row.stock_unit,
  stockAverageCost: Number(row.stock_unit_cost || 0),
  stockValueAfter: Number(row.stock_value_after || 0),
});
const writeItemLog = async (connection, { line, action, oldData, newData, user }) => {
  const by = actor(user);

  await connection.query(
    `INSERT INTO history_stock_raw_purchase_item_logs
      (purchase_item_id, purchase_id, stock_item_id, item_name, action, old_data, new_data, user_id, user_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      line.id,
      line.purchase_id,
      line.stock_item_id,
      line.item_name,
      action,
      oldData == null ? null : JSON.stringify(oldData),
      newData == null ? null : JSON.stringify(newData),
      by.userId,
      by.userName,
    ]
  );
};

// A new name may not be a bahan setengah jadi or perlengkapan.
const checkNewItem = async (connection, { itemName }) => {
  const name = clean(itemName, 150, "Nama barang");
  const [semiRows] = await connection.query("SELECT id FROM stock_semi_items WHERE name = ?", [name]);
  if (semiRows.length) throw createError(400, `${name} adalah bahan setengah jadi, stoknya dari Catat Masak. Belanjakan bahan bakunya.`);
  const [supplyRows] = await connection.query("SELECT id FROM stock_supply_items WHERE name = ?", [name]);
  if (supplyRows.length) throw createError(400, `${name} ada di Stok → Lainnya. Pilih Jenis Belanja Lainnya.`);
  const [[existing]] = await connection.query("SELECT is_active FROM stock_raw_items WHERE name = ?", [name]);
  if (existing && !existing.is_active) throw createError(409, "Barang sudah ada tetapi tidak aktif. Aktifkan melalui pengelolaan stok.");
};

const RAW_NOTA = {
  kind: "raw",
  label: "belanja",
  purchases: "history_stock_raw_purchases",
  items: "history_stock_raw_purchase_items",
  attachments: RECEIPT_TARGETS.raw.attachments,
  attachmentUrl: RECEIPT_TARGETS.raw.url,
  stockTable: "stock_raw_items",
  itemFk: "stock_item_id",
  itemIdKey: "stockItemId",
  referenceTypes: {
    purchase: REFERENCE_TYPES.purchase,
    edit: REFERENCE_TYPES.purchaseEdit,
    delete: REFERENCE_TYPES.purchaseDelete,
  },
  normalize: normalizePurchase,
  ledgerNote: (id, supplierName) => `Belanja #${id} - ${supplierName}`,
  missingUnitMessage: name => `Lengkapi satuan ${name} di Stok → Bahan Baku terlebih dahulu.`,
  unlinkedMessage: "Item belanja ini tidak terhubung ke stok.",
  stockMissingMessage: "Barang stok tidak ditemukan.",
  checkNewItem,
  // The unit is set by the first posted purchase.
  createItem: async (connection, line) => {
    await checkNewItem(connection, { itemName: line.item_name });
    await connection.query(`INSERT INTO stock_raw_items (name, category, unit, stock, minimum_stock)
      VALUES (?, 'Umum', '', 0, 0) ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`, [line.item_name]);
    const [[row]] = await connection.query("SELECT id FROM stock_raw_items WHERE name = ?", [line.item_name]);
    return row.id;
  },
  afterStock: (connection, stockItemIds) => refreshMenuCosts(connection, { stockItemIds }),
  logLine: writeItemLog,
  snapshotLine: snapshotItem,
};

const createShoppingService = (db, { receiptDir } = {}) => {
  const nota = createNotaEngine(db, { ...RAW_NOTA, receiptDir });
  const suppliers = async () => (await db.query("SELECT id, name FROM suplier ORDER BY name"))[0];
  const saveSupplier = async ({ id, name }) => {
    name = clean(name, 150, "Nama suplier");
    try {
      if (id != null) {
        id = number(id, 1, 4294967295, 0, "ID suplier");
        const [result] = await db.query("UPDATE suplier SET name = ? WHERE id = ?", [name, id]);
        if (!result.affectedRows) throw createError(404, "Suplier tidak ditemukan.");
      } else {
        const [result] = await db.query("INSERT INTO suplier (name) VALUES (?)", [name]);
        id = result.insertId;
      }
      return { id, name };
    } catch (error) {
      if (error.code === "ER_DUP_ENTRY") throw createError(409, "Nama suplier sudah digunakan. Pilih nama lain atau ubah suplier yang sudah ada.");
      throw error;
    }
  };
  // itemId keeps one bahan baku: its detail (COGS, riwayat, log) opened from a
  // line of the Per Nota history. from/to keep a period (dateRange).
  const list = async ({ page = 1, search = "", itemId = "", from, to } = {}) => {
    page = Math.max(1, Math.floor(Number(page) || 1));
    const keyword = `%${String(search).slice(0,150)}%`;
    const stockItemId = itemFilter(itemId);
    const period = dateRange({ from, to });
    const params = [keyword, keyword, ...(stockItemId ? [stockItemId] : []), ...period.params];
    // Drafts are listed separately (listDrafts) until they are posted.
    const where = `WHERE p.status = 'posted' AND (p.suplier_name LIKE ? OR EXISTS (SELECT 1 FROM history_stock_raw_purchase_items i WHERE i.purchase_id = p.id AND i.item_name LIKE ?))${stockItemId ? " AND EXISTS (SELECT 1 FROM history_stock_raw_purchase_items fi WHERE fi.purchase_id = p.id AND fi.stock_item_id = ?)" : ""}${period.sql}`;
    const itemWhere = `WHERE p.status = 'posted' AND (p.suplier_name LIKE ? OR i.item_name LIKE ?)${stockItemId ? " AND i.stock_item_id = ?" : ""}${period.sql}`;
    const [[count]] = await db.query(`SELECT COUNT(*) AS total FROM history_stock_raw_purchases p ${where}`, params);
    const [rows] = await db.query(`SELECT p.* FROM history_stock_raw_purchases p ${where} ORDER BY p.purchase_date DESC, p.id DESC LIMIT 10 OFFSET ?`, [...params, (page-1)*10]);
    if (rows.length) {
      const [items] = await db.query(`SELECT * FROM history_stock_raw_purchase_items WHERE purchase_id IN (${rows.map(()=>"?").join(",")}) ORDER BY id`, rows.map(row=>row.id));
      rows.forEach(row => { delete row.payload_hash; delete row.request_id; row.items = items.filter(item=>item.purchase_id===row.id); });
    }
    const [itemRows] = await db.query(
      `SELECT
         i.*,
         p.purchase_date,
         p.suplier_name,
         p.payment_method,
         p.note,
         si.stock,
         si.unit AS current_unit,
         si.unit_cost,
         si.stock_value
       FROM history_stock_raw_purchase_items i
       JOIN history_stock_raw_purchases p ON p.id = i.purchase_id
       LEFT JOIN stock_raw_items si ON si.id = i.stock_item_id
       ${itemWhere}
       ORDER BY i.item_name ASC, p.purchase_date DESC, p.id DESC, i.id DESC`,
      params
    );
    const attachmentsByPurchase = new Map();
    const purchaseIds = [...new Set([...rows.map(row => row.id), ...itemRows.map(row => row.purchase_id)])];
    if (purchaseIds.length) {
      const [attachments] = await db.query(
        `SELECT id, purchase_id, original_name, created_at
         FROM history_stock_raw_purchase_attachments
         WHERE purchase_id IN (${purchaseIds.map(() => "?").join(",")})
         ORDER BY id`,
        purchaseIds
      );
      attachments.forEach(attachment => {
        const list = attachmentsByPurchase.get(attachment.purchase_id) || [];
        list.push({
          id: attachment.id,
          url: attachmentUrl(attachment.id),
          name: attachment.original_name,
          createdAt: attachment.created_at,
        });
        attachmentsByPurchase.set(attachment.purchase_id, list);
      });
    }
    rows.forEach(row => { row.attachments = attachmentsByPurchase.get(row.id) || []; });
    const groupedItems = Array.from(
      itemRows.reduce((groups, row) => {
        const key = row.stock_item_id ? `stock:${row.stock_item_id}` : `name:${row.item_name.toLowerCase()}`;

        if (!groups.has(key)) {
          groups.set(key, {
            stockItemId: row.stock_item_id,
            itemName: row.item_name,
            stock: row.stock == null ? null : Number(row.stock),
            stockUnit: row.current_unit || row.stock_unit,
            averageCost: Number(row.unit_cost || 0),
            stockValue: Number(row.stock_value || 0),
            purchaseCount: 0,
            histories: [],
          });
        }

        const group = groups.get(key);
        group.purchaseCount += 1;
        group.histories.push({
          id: row.id,
          purchaseId: row.purchase_id,
          itemName: row.item_name,
          purchaseDate: row.purchase_date,
          supplierName: row.suplier_name,
          paymentMethod: row.payment_method,
          note: row.note || "",
          quantity: Number(row.quantity),
          unit: row.unit,
          unitPrice: Number(row.unit_price),
          total: Number(row.total),
          costTotal: Number(row.cost_total ?? row.total),
          stockQuantity: Number(row.stock_quantity),
          stockUnit: row.stock_unit,
          stockAverageCost: Number(row.stock_unit_cost || 0),
          stockValueAfter: Number(row.stock_value_after || 0),
          attachments: attachmentsByPurchase.get(row.purchase_id) || [],
        });

        return groups;
      }, new Map()).values()
    );
    const stockIds = groupedItems
      .map(group => group.stockItemId)
      .filter(Boolean);
    const logsByStockId = new Map();

    if (stockIds.length) {
      const [logs] = await db.query(
        `SELECT *
         FROM history_stock_raw_purchase_item_logs
         WHERE stock_item_id IN (${stockIds.map(() => "?").join(",")})
         ORDER BY created_at DESC, id DESC
         LIMIT 200`,
        stockIds
      );

      logs.forEach(log => {
        const list = logsByStockId.get(log.stock_item_id) || [];
        list.push({
          id: log.id,
          purchaseItemId: log.purchase_item_id,
          purchaseId: log.purchase_id,
          stockItemId: log.stock_item_id,
          itemName: log.item_name,
          action: log.action,
          oldData: parseJson(log.old_data),
          newData: parseJson(log.new_data),
          userId: log.user_id,
          userName: log.user_name || "Admin",
          createdAt: log.created_at,
        });
        logsByStockId.set(log.stock_item_id, list);
      });
    }

    groupedItems.forEach(group => {
      group.logs = logsByStockId.get(group.stockItemId) || [];
    });
    const groupTotal = groupedItems.length;
    const itemGroups = groupedItems.slice((page - 1) * 10, page * 10);

    return { purchases: rows, total: Number(count.total), itemGroups, groupTotal, page };
  };
  return {
    suppliers,
    saveSupplier,
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

module.exports = { ...createShoppingService(pool), createShoppingService };
