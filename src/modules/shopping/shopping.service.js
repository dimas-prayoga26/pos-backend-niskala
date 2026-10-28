// Purchases (belanja) receive stock: each save is one transaction that creates
// missing suppliers/items, raises stock and recomputes the moving average cost.
// request_id makes retries idempotent; see SHOPPING.md for the business rules.
const createError = require("http-errors");
const crypto = require("node:crypto");
const { pool } = require("../../infrastructure/database/pool");
const { roundCost, roundCurrency } = require("../../shared/utils/money");
const { refreshMenuCosts } = require("../menu/menu.costs");
const {
  clean,
  convertQuantity,
  normalizeItemPatch,
  normalizePurchase,
  number,
} = require("./shopping.validation");

const parseJson = value => {
  if (!value) return null;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return null; }
};
const actor = user => {
  if (typeof user === "number" || typeof user === "string") {
    return { userId: user || null, userName: "Admin" };
  }

  return {
    userId: user?.id || user?._id || null,
    userName: [user?.name, user?.email].filter(Boolean).join(" - ").slice(0, 150) || "Admin",
  };
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
const writeItemLog = async (connection, { item, action, oldData, newData, user }) => {
  const by = actor(user);

  await connection.query(
    `INSERT INTO history_stock_purchase_item_logs
      (purchase_item_id, purchase_id, stock_item_id, item_name, action, old_data, new_data, user_id, user_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      item.id,
      item.purchase_id,
      item.stock_item_id,
      item.item_name,
      action,
      oldData == null ? null : JSON.stringify(oldData),
      newData == null ? null : JSON.stringify(newData),
      by.userId,
      by.userName,
    ]
  );
};
const updatePurchaseTotal = async (connection, purchaseId) => {
  const [[totalRow]] = await connection.query(
    "SELECT COALESCE(SUM(total), 0) AS total FROM history_stock_purchase_items WHERE purchase_id = ?",
    [purchaseId]
  );
  await connection.query("UPDATE history_stock_purchases SET total = ? WHERE id = ?", [
    roundCurrency(totalRow.total),
    purchaseId,
  ]);
};
const applyStockDelta = async (connection, stockItemId, deltaQty, deltaValue) => {
  const [[stock]] = await connection.query(
    "SELECT * FROM stock_items WHERE id = ? FOR UPDATE",
    [stockItemId]
  );
  if (!stock) throw createError(404, "Barang stok tidak ditemukan.");

  const nextStock = Math.round((Number(stock.stock || 0) + deltaQty) * 100) / 100;
  const nextValue = roundCurrency(Number(stock.stock_value || 0) + deltaValue);
  const nextAverageCost = nextStock > 0 ? roundCost(nextValue / nextStock) : 0;

  await connection.query(
    "UPDATE stock_items SET stock = ?, stock_value = ?, unit_cost = ? WHERE id = ?",
    [nextStock, nextValue, nextAverageCost, stockItemId]
  );

  return { stock: nextStock, stockValue: nextValue, averageCost: nextAverageCost };
};

const createShoppingService = db => {
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
  const createSupplier = async (connection, name) => {
    name = clean(name, 150, "Toko/sumber");
    await connection.query("INSERT INTO suplier (name) VALUES (?) ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)", [name]);
    return (await connection.query("SELECT id, name FROM suplier WHERE name = ?", [name]))[0][0];
  };
  const createItem = async (connection, name) => {
    name = clean(name, 150, "Nama barang");
    // Unit is set on first purchase, after qty and unit have been entered.
    await connection.query(`INSERT INTO stock_items (name, category, unit, stock, minimum_stock)
      VALUES (?, 'Umum', '', 0, 0) ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`, [name]);
    const row = (await connection.query("SELECT id, name, unit, stock, is_active FROM stock_items WHERE name = ?", [name]))[0][0];
    if (!row.is_active) throw createError(409, "Barang sudah ada tetapi tidak aktif. Aktifkan melalui pengelolaan stok.");
    return { id: row.id, name: row.name, unit: row.unit, stock: Number(row.stock) };
  };
  const save = async (body, user) => {
    const userId = typeof user === "object" && user ? user.id || user._id : user;
    const data = normalizePurchase(body);
    const hash = crypto.createHash("sha256").update(JSON.stringify({ ...data, userId })).digest("hex");
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const supplier = data.suplierName
        ? await createSupplier(connection, data.suplierName)
        : (await connection.query("SELECT id, name FROM suplier WHERE id = ?", [data.suplierId]))[0][0];
      if (!supplier) throw createError(400, "Toko/sumber tidak ditemukan.");
      const total = data.items.reduce((sum, item) => sum + Math.round(item.quantity * item.unitPrice * 100), 0) / 100;
      number(total, 0, 999999999999.99, 2, "Total belanja");
      const [header] = await connection.query(`INSERT INTO history_stock_purchases
        (request_id, payload_hash, purchase_date, suplier_id, suplier_name, payment_method, note, total, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [data.requestId, hash, data.date, supplier.id, supplier.name, data.paymentMethod, data.note, total, userId]);
      // Resolve temporary names only inside the purchase transaction.
      const newItems = new Map();
      for (const name of [...new Set(data.items.map(item => item.itemName).filter(Boolean))].sort()) {
        newItems.set(name, await createItem(connection, name));
      }
      const items = data.items.map(item => ({ ...item, stockItemId: item.stockItemId || newItems.get(item.itemName).id }));
      const ids = [...new Set(items.map(item => item.stockItemId))].sort((a,b) => a-b);
      const [stocks] = await connection.query(`SELECT * FROM stock_items WHERE id IN (${ids.map(()=>"?").join(",")}) ORDER BY id FOR UPDATE`, ids);
      const byId = new Map(stocks.map(stock => [stock.id, stock]));
      for (const item of items) {
        const stock = byId.get(item.stockItemId);
        if (!stock || !stock.is_active) throw createError(400, "Salah satu barang tidak tersedia. Muat ulang daftar barang.");
        if (!stock.unit) {
          if (Number(stock.stock) !== 0) throw createError(400, `Lengkapi satuan ${stock.name} di Stok Barang terlebih dahulu.`);
          stock.unit = item.unit;
        }
        const stockQty = convertQuantity(item.quantity, item.unit, stock.unit);
        const previousStock = Math.max(Number(stock.stock || 0), 0);
        const previousAverageCost = Number(stock.unit_cost || 0);
        const previousValue = Math.max(
          Number(stock.stock_value || 0),
          roundCurrency(previousStock * previousAverageCost)
        );
        const purchaseValue = roundCurrency(item.quantity * item.unitPrice);
        stock.stock = Math.round((Number(stock.stock) + stockQty) * 100) / 100;
        number(stock.stock, -9999999999.99, 9999999999.99, 2, "Jumlah stok akhir");
        stock.stock_value = roundCurrency(previousValue + purchaseValue);
        stock.unit_cost = stock.stock > 0 ? roundCost(stock.stock_value / stock.stock) : 0;
        await connection.query(
          "UPDATE stock_items SET stock = ?, unit = ?, unit_cost = ?, stock_value = ?, supplier = ? WHERE id = ?",
          [stock.stock, stock.unit, stock.unit_cost, stock.stock_value, supplier.name, stock.id]
        );
        const [insertedItem] = await connection.query(`INSERT INTO history_stock_purchase_items
          (purchase_id, stock_item_id, item_name, quantity, unit, unit_price, total, stock_quantity, stock_unit, stock_unit_cost, stock_value_after)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [header.insertId, stock.id, stock.name, item.quantity, item.unit, item.unitPrice, purchaseValue, stockQty, stock.unit, stock.unit_cost, stock.stock_value]);
        const [[createdItem]] = await connection.query(
          "SELECT * FROM history_stock_purchase_items WHERE id = ?",
          [insertedItem.insertId]
        );
        await writeItemLog(connection, {
          item: createdItem,
          action: "create",
          oldData: null,
          newData: snapshotItem(createdItem),
          user,
        });
      }
      await refreshMenuCosts(connection, { stockItemIds: ids });
      await connection.commit();
      return { id: header.insertId, total, duplicate: false };
    } catch (error) {
      await connection.rollback();
      if (error.code === "ER_DUP_ENTRY") {
        const [[existing]] = await connection.query("SELECT id, total, payload_hash FROM history_stock_purchases WHERE request_id = ?", [data.requestId]);
        if (existing) {
          if (existing.payload_hash !== hash) throw createError(409, "Permintaan ini sudah disimpan dengan isi berbeda. Muat ulang form untuk belanja baru.");
          return { id: existing.id, total: Number(existing.total), duplicate: true };
        }
      }
      throw error;
    } finally { connection.release(); }
  };
  const updateItem = async (id, body, user) => {
    id = number(id, 1, 4294967295, 0, "ID item belanja");
    const data = normalizeItemPatch(body);
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();
      const [[item]] = await connection.query(
        "SELECT * FROM history_stock_purchase_items WHERE id = ? FOR UPDATE",
        [id]
      );
      if (!item) throw createError(404, "Item belanja tidak ditemukan.");
      if (!item.stock_item_id) throw createError(400, "Item belanja ini tidak terhubung ke stok.");

      const [[stock]] = await connection.query(
        "SELECT * FROM stock_items WHERE id = ? FOR UPDATE",
        [item.stock_item_id]
      );
      if (!stock) throw createError(404, "Barang stok tidak ditemukan.");

      const oldData = snapshotItem(item);
      const stockQty = convertQuantity(data.quantity, data.unit, stock.unit || item.stock_unit);
      const total = roundCurrency(data.quantity * data.unitPrice);
      const stockState = await applyStockDelta(
        connection,
        item.stock_item_id,
        stockQty - Number(item.stock_quantity || 0),
        total - Number(item.total || 0)
      );

      await connection.query(
        `UPDATE history_stock_purchase_items
         SET quantity = ?, unit = ?, unit_price = ?, total = ?,
             stock_quantity = ?, stock_unit = ?, stock_unit_cost = ?, stock_value_after = ?
         WHERE id = ?`,
        [
          data.quantity,
          data.unit,
          data.unitPrice,
          total,
          stockQty,
          stock.unit || item.stock_unit,
          stockState.averageCost,
          stockState.stockValue,
          id,
        ]
      );
      await updatePurchaseTotal(connection, item.purchase_id);
      await refreshMenuCosts(connection, { stockItemIds: [item.stock_item_id] });

      const [[updated]] = await connection.query(
        "SELECT * FROM history_stock_purchase_items WHERE id = ?",
        [id]
      );
      const newData = snapshotItem(updated);
      await writeItemLog(connection, { item, action: "edit", oldData, newData, user });

      await connection.commit();
      return newData;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  };
  const deleteItem = async (id, user) => {
    id = number(id, 1, 4294967295, 0, "ID item belanja");
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();
      const [[item]] = await connection.query(
        "SELECT * FROM history_stock_purchase_items WHERE id = ? FOR UPDATE",
        [id]
      );
      if (!item) throw createError(404, "Item belanja tidak ditemukan.");
      if (!item.stock_item_id) throw createError(400, "Item belanja ini tidak terhubung ke stok.");

      const oldData = snapshotItem(item);
      await applyStockDelta(
        connection,
        item.stock_item_id,
        -Number(item.stock_quantity || 0),
        -Number(item.total || 0)
      );
      await writeItemLog(connection, { item, action: "delete", oldData, newData: null, user });
      await connection.query("DELETE FROM history_stock_purchase_items WHERE id = ?", [id]);
      await updatePurchaseTotal(connection, item.purchase_id);
      await refreshMenuCosts(connection, { stockItemIds: [item.stock_item_id] });

      await connection.commit();
      return oldData;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  };
  const list = async ({ page = 1, search = "" } = {}) => {
    page = Math.max(1, Math.floor(Number(page) || 1));
    const keyword = `%${String(search).slice(0,150)}%`;
    const where = `WHERE p.suplier_name LIKE ? OR EXISTS (SELECT 1 FROM history_stock_purchase_items i WHERE i.purchase_id = p.id AND i.item_name LIKE ?)`;
    const itemWhere = `WHERE p.suplier_name LIKE ? OR i.item_name LIKE ?`;
    const [[count]] = await db.query(`SELECT COUNT(*) AS total FROM history_stock_purchases p ${where}`, [keyword, keyword]);
    const [rows] = await db.query(`SELECT p.* FROM history_stock_purchases p ${where} ORDER BY p.purchase_date DESC, p.id DESC LIMIT 10 OFFSET ?`, [keyword, keyword, (page-1)*10]);
    if (rows.length) {
      const [items] = await db.query(`SELECT * FROM history_stock_purchase_items WHERE purchase_id IN (${rows.map(()=>"?").join(",")}) ORDER BY id`, rows.map(row=>row.id));
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
       FROM history_stock_purchase_items i
       JOIN history_stock_purchases p ON p.id = i.purchase_id
       LEFT JOIN stock_items si ON si.id = i.stock_item_id
       ${itemWhere}
       ORDER BY i.item_name ASC, p.purchase_date DESC, p.id DESC, i.id DESC`,
      [keyword, keyword]
    );
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
          stockQuantity: Number(row.stock_quantity),
          stockUnit: row.stock_unit,
          stockAverageCost: Number(row.stock_unit_cost || 0),
          stockValueAfter: Number(row.stock_value_after || 0),
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
         FROM history_stock_purchase_item_logs
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
  return { suppliers, saveSupplier, save, updateItem, deleteItem, list };
};

module.exports = { ...createShoppingService(pool), createShoppingService };
