// The nota engine shared by belanja bahan baku (shopping.service) and belanja
// lainnya (shopping.supply). A nota is a header with its footer
// (subtotal, ongkir, diskon, PPN, grand total) and item lines.
// - Saved as "draft" it moves nothing; staff can change or delete it.
// - Posting it (admin) creates new items, raises stock by each line's
//   cost_total (its amount plus its share of ongkir/PPN minus diskon) with a
//   moving average (shopping.costing), and posts the grand total as saldo
//   keluar, in the same transaction.
// - Changing or deleting a line of a posted nota spreads the footer again
//   and moves stock and saldo by the differences.
const createError = require("http-errors");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { PURCHASE_RECEIPT_DIR } = require("../../config/paths");
const { roundCost, roundCurrency } = require("../../shared/utils/money");
const { clean, dateKey, number, todayKey } = require("../../shared/utils/validate");
const { findPurchaseSourceId, postMutation } = require("../paymentSources/paymentSource.ledger");
const { receiveIntoStock } = require("./shopping.costing");
const { NO_ADJUSTMENTS, adjustmentsFromHeader, computeNotaTotals } = require("./shopping.totals");
const { convertQuantity, normalizeItemPatch } = require("./shopping.validation");

const NOTA_PAGE_SIZE = 10;

// The optional ?itemId= of a history list: one barang, or none ("").
const itemFilter = value => {
  if (value === undefined || value === null || value === "") return null;
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw createError(400, "ID barang tidak valid.");
  return id;
};

// The optional ?from=&to= (YYYY-MM-DD) of a history list, the period filter of
// the Belanja page: purchases dated in it, both days included. As SQL on the
// nota alias p, with its params; no dates is no limit.
const dateRange = ({ from, to } = {}) => {
  const start = from == null || from === "" ? null : dateKey(from, "Tanggal awal");
  const end = to == null || to === "" ? null : dateKey(to, "Tanggal akhir");
  if (start && end && start > end) throw createError(400, "Tanggal awal tidak boleh setelah tanggal akhir.");
  return {
    sql: `${start ? " AND p.purchase_date >= ?" : ""}${end ? " AND p.purchase_date <= ?" : ""}`,
    params: [...(start ? [start] : []), ...(end ? [end] : [])],
  };
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

// The nota's toko: an existing suplier or one created inside the purchase transaction.
const findOrCreateSupplier = async (connection, name) => {
  name = clean(name, 150, "Toko/sumber");
  await connection.query("INSERT INTO suplier (name) VALUES (?) ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)", [name]);
  return (await connection.query("SELECT id, name FROM suplier WHERE name = ?", [name]))[0][0];
};

// Editing or deleting a line changes what the nota cost: amount > 0 returns
// money to the nota's payment source, amount < 0 takes more from it.
// purchaseReferenceType is the mutation that paid the nota (purchase or
// supply_purchase); notas without one never moved a balance.
const postPurchaseDifference = async (
  connection,
  { purchaseId, amount, referenceType, note, user, purchaseReferenceType }
) => {
  amount = roundCurrency(amount);
  if (!amount) return;
  const sourceId = await findPurchaseSourceId(connection, purchaseId, purchaseReferenceType);
  if (!sourceId) return;
  await postMutation(connection, {
    sourceId,
    amount,
    date: todayKey(),
    referenceType,
    referenceId: purchaseId,
    note,
    userId: actor(user).userId,
  });
};

const lineAmount = item => roundCurrency(item.quantity * item.unitPrice);
const footerColumns = totals => [
  totals.subtotal,
  totals.shippingCost,
  totals.discountAmount,
  totals.taxAmount,
  totals.total,
];

// cfg describes one kind of nota: its tables, the stock table of its items,
// the API name of an item id (itemIdKey), ledger reference types, and hooks
// (checkNewItem, createItem, afterStock, logLine, lineCategory).
const createNotaEngine = (db, cfg) => {
  const withTransaction = async fn => {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const result = await fn(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  };

  const resolveHeader = async (connection, data) => {
    const supplier = data.suplierName
      ? await findOrCreateSupplier(connection, data.suplierName)
      : (await connection.query("SELECT id, name FROM suplier WHERE id = ?", [data.suplierId]))[0][0];
    if (!supplier) throw createError(400, "Toko/sumber tidak ditemukan.");
    const source = data.paymentSourceId
      ? (await connection.query("SELECT id, name FROM meta_data_payment_source WHERE id = ? AND is_active = TRUE", [data.paymentSourceId]))[0][0]
      : null;
    if (data.paymentSourceId && !source) throw createError(400, "Sumber pembayaran tidak tersedia. Muat ulang form.");
    return { supplier, source };
  };

  // Drafts are checked like posted notas: chosen items exist and are active,
  // quantities convert to their stock unit, and new names are free.
  const checkLines = async (connection, items) => {
    const ids = [...new Set(items.map(item => item[cfg.itemIdKey]).filter(Boolean))];
    const [stocks] = ids.length
      ? await connection.query(`SELECT * FROM ${cfg.stockTable} WHERE id IN (${ids.map(() => "?").join(",")})`, ids)
      : [[]];
    const byId = new Map(stocks.map(stock => [stock.id, stock]));
    for (const item of items) {
      const id = item[cfg.itemIdKey];
      if (!id) {
        await cfg.checkNewItem(connection, item);
        continue;
      }
      const stock = byId.get(id);
      if (!stock || !stock.is_active) throw createError(400, "Salah satu barang tidak tersedia. Muat ulang daftar barang.");
      if (stock.unit && item.unit) convertQuantity(item.quantity, item.unit, stock.unit);
    }
    return byId;
  };

  // Lines sent without unit (cfg.defaultUnit kinds) take their item's unit.
  const withUnits = (items, stocksById) =>
    items.map(item =>
      item.unit ? item : { ...item, unit: stocksById.get(item[cfg.itemIdKey])?.unit || cfg.defaultUnit }
    );

  const insertLines = async (connection, purchaseId, items, totals, stocksById) => {
    for (const [index, item] of items.entries()) {
      const stock = stocksById.get(item[cfg.itemIdKey]);
      const category = cfg.lineCategory ? [cfg.lineCategory(item, stock)] : [];
      await connection.query(
        `INSERT INTO ${cfg.items}
          (purchase_id, ${cfg.itemFk}, item_name, ${cfg.lineCategory ? "category, " : ""}quantity, unit, unit_price, total, cost_total, stock_quantity, stock_unit)
         VALUES (?, ?, ?, ${cfg.lineCategory ? "?, " : ""}?, ?, ?, ?, ?, ?, ?)`,
        [
          purchaseId,
          stock ? stock.id : null,
          stock ? stock.name : item.itemName,
          ...category,
          item.quantity,
          item.unit,
          item.unitPrice,
          lineAmount(item),
          totals.costTotals[index],
          item.quantity,
          stock?.unit || item.unit,
        ]
      );
    }
  };

  // Moves a draft into stock and saldo. The header must already be saved.
  const post = async (connection, purchaseId, user) => {
    const [[header]] = await connection.query(`SELECT * FROM ${cfg.purchases} WHERE id = ? FOR UPDATE`, [purchaseId]);
    if (!header) throw createError(404, "Nota tidak ditemukan.");
    if (header.status === "posted") throw createError(409, "Nota ini sudah diposting.");
    const source = header.payment_source_id
      ? (await connection.query("SELECT id, name FROM meta_data_payment_source WHERE id = ? AND is_active = TRUE", [header.payment_source_id]))[0][0]
      : null;
    if (header.payment_source_id && !source) {
      throw createError(400, "Sumber pembayaran nota ini sudah tidak aktif. Pilih sumber lain.");
    }
    const [lines] = await connection.query(`SELECT * FROM ${cfg.items} WHERE purchase_id = ? ORDER BY id`, [purchaseId]);

    // New names become items in name order, as they always have.
    const created = new Map();
    const newLines = lines.filter(line => !line[cfg.itemFk]);
    for (const name of [...new Set(newLines.map(line => line.item_name))].sort()) {
      created.set(name, await cfg.createItem(connection, newLines.find(line => line.item_name === name)));
    }
    const stockIdOf = line => line[cfg.itemFk] || created.get(line.item_name);
    const ids = [...new Set(lines.map(stockIdOf))].sort((a, b) => a - b);
    const [stocks] = await connection.query(
      `SELECT * FROM ${cfg.stockTable} WHERE id IN (${ids.map(() => "?").join(",")}) ORDER BY id FOR UPDATE`,
      ids
    );
    const byId = new Map(stocks.map(stock => [stock.id, stock]));
    for (const line of lines) {
      const stock = byId.get(stockIdOf(line));
      if (!stock || !stock.is_active) throw createError(400, "Salah satu barang tidak tersedia. Muat ulang daftar barang.");
      if (!stock.unit) {
        if (Number(stock.stock) !== 0) throw createError(400, cfg.missingUnitMessage(stock.name));
        stock.unit = line.unit;
      }
      const stockQty = convertQuantity(Number(line.quantity), line.unit, stock.unit);
      const received = receiveIntoStock(
        { stock: stock.stock, stockValue: stock.stock_value, unitCost: stock.unit_cost },
        stockQty,
        Number(line.cost_total)
      );
      number(received.stock, -9999999999.99, 9999999999.99, 2, "Jumlah stok akhir");
      stock.stock = received.stock;
      stock.stock_value = received.stockValue;
      stock.unit_cost = received.unitCost;
      await connection.query(
        `UPDATE ${cfg.stockTable} SET stock = ?, unit = ?, unit_cost = ?, stock_value = ?, supplier = ? WHERE id = ?`,
        [stock.stock, stock.unit, stock.unit_cost, stock.stock_value, header.suplier_name, stock.id]
      );
      await connection.query(
        `UPDATE ${cfg.items}
         SET ${cfg.itemFk} = ?, item_name = ?, ${cfg.lineCategory ? "category = ?, " : ""}
             stock_quantity = ?, stock_unit = ?, stock_unit_cost = ?, stock_value_after = ?
         WHERE id = ?`,
        [
          stock.id,
          stock.name,
          ...(cfg.lineCategory ? [stock.category] : []),
          stockQty,
          stock.unit,
          stock.unit_cost,
          stock.stock_value,
          line.id,
        ]
      );
      if (cfg.logLine) {
        const [[posted]] = await connection.query(`SELECT * FROM ${cfg.items} WHERE id = ?`, [line.id]);
        await cfg.logLine(connection, { line: posted, action: "create", oldData: null, newData: cfg.snapshotLine(posted), user });
      }
    }
    await cfg.afterStock(connection, ids);

    const payment = source
      ? await postMutation(connection, {
        sourceId: source.id,
        amount: -Number(header.total),
        date: header.purchase_date,
        referenceType: cfg.referenceTypes.purchase,
        referenceId: header.id,
        note: cfg.ledgerNote(header.id, header.suplier_name),
        userId: actor(user).userId,
      })
      : null;
    await connection.query(
      `UPDATE ${cfg.purchases}
       SET status = 'posted', payment_method = ?, posted_at = CURRENT_TIMESTAMP, posted_by = ?
       WHERE id = ?`,
      [source ? source.name : header.payment_method, actor(user).userId, header.id]
    );
    return payment;
  };

  const notaValues = (data, supplier, source, totals) => [
    data.date,
    supplier.id,
    supplier.name,
    source ? source.name : data.paymentMethod,
    source ? source.id : null,
    data.note,
    ...footerColumns(totals),
    (data.adjustments || NO_ADJUSTMENTS).discountType,
    (data.adjustments || NO_ADJUSTMENTS).discountValue,
    (data.adjustments || NO_ADJUSTMENTS).taxPercent,
  ];
  const paymentResult = payment => payment && { paymentSourceId: payment.sourceId, balance: payment.balance };

  // A new nota, posted right away unless status is "draft". requestId makes
  // retries idempotent.
  const create = async (body, user) => {
    const userId = typeof user === "object" && user ? user.id || user._id : user;
    const data = cfg.normalize(body);
    const status = data.status || "posted";
    const hash = crypto.createHash("sha256").update(JSON.stringify({ ...data, userId })).digest("hex");
    try {
      return await withTransaction(async connection => {
        const { supplier, source } = await resolveHeader(connection, data);
        const totals = computeNotaTotals(data.items.map(lineAmount), data.adjustments || NO_ADJUSTMENTS);
        number(totals.total, 0, 999999999999.99, 2, "Total belanja");
        // The header goes first (as it always has), then the lines are checked.
        const [header] = await connection.query(
          `INSERT INTO ${cfg.purchases}
            (request_id, payload_hash, purchase_date, suplier_id, suplier_name, payment_method, payment_source_id, note,
             subtotal, shipping_cost, discount_amount, tax_amount, total, discount_type, discount_value, tax_percent,
             status, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)`,
          [data.requestId, hash, ...notaValues(data, supplier, source, totals), userId]
        );
        const stocksById = await checkLines(connection, data.items);
        await insertLines(connection, header.insertId, withUnits(data.items, stocksById), totals, stocksById);
        const payment = status === "posted" ? await post(connection, header.insertId, user) : null;
        return { id: header.insertId, total: totals.total, duplicate: false, ...paymentResult(payment), status };
      });
    } catch (error) {
      if (error.code === "ER_DUP_ENTRY") {
        const [[existing]] = await db.query(
          `SELECT id, total, payload_hash, status FROM ${cfg.purchases} WHERE request_id = ?`,
          [data.requestId]
        );
        if (existing) {
          if (existing.payload_hash !== hash) throw createError(409, "Permintaan ini sudah disimpan dengan isi berbeda. Muat ulang form untuk belanja baru.");
          return { id: existing.id, total: Number(existing.total), duplicate: true, status: existing.status };
        }
      }
      throw error;
    }
  };

  // Replaces a draft's header and lines; status "posted" also posts it.
  const updateDraft = async (purchaseId, body, user) => {
    purchaseId = number(purchaseId, 1, 4294967295, 0, "ID nota");
    const data = cfg.normalize(body, { requireRequestId: false });
    const status = data.status || "posted";
    return withTransaction(async connection => {
      const [[current]] = await connection.query(`SELECT id, status FROM ${cfg.purchases} WHERE id = ? FOR UPDATE`, [purchaseId]);
      if (!current) throw createError(404, "Nota tidak ditemukan.");
      if (current.status === "posted") throw createError(409, "Nota ini sudah diposting dan tidak bisa diubah lewat draft.");
      const { supplier, source } = await resolveHeader(connection, data);
      const stocksById = await checkLines(connection, data.items);
      const totals = computeNotaTotals(data.items.map(lineAmount), data.adjustments || NO_ADJUSTMENTS);
      number(totals.total, 0, 999999999999.99, 2, "Total belanja");
      await connection.query(
        `UPDATE ${cfg.purchases}
         SET purchase_date = ?, suplier_id = ?, suplier_name = ?, payment_method = ?, payment_source_id = ?, note = ?,
             subtotal = ?, shipping_cost = ?, discount_amount = ?, tax_amount = ?, total = ?,
             discount_type = ?, discount_value = ?, tax_percent = ?
         WHERE id = ?`,
        [...notaValues(data, supplier, source, totals), purchaseId]
      );
      await connection.query(`DELETE FROM ${cfg.items} WHERE purchase_id = ?`, [purchaseId]);
      await insertLines(connection, purchaseId, withUnits(data.items, stocksById), totals, stocksById);
      const payment = status === "posted" ? await post(connection, purchaseId, user) : null;
      return { id: purchaseId, total: totals.total, ...paymentResult(payment), status };
    });
  };

  // Only drafts are deleted; their photos go with them.
  const removeDraft = async purchaseId => {
    purchaseId = number(purchaseId, 1, 4294967295, 0, "ID nota");
    const files = await withTransaction(async connection => {
      const [[current]] = await connection.query(`SELECT id, status FROM ${cfg.purchases} WHERE id = ? FOR UPDATE`, [purchaseId]);
      if (!current) throw createError(404, "Nota tidak ditemukan.");
      if (current.status === "posted") {
        throw createError(409, "Nota yang sudah diposting tidak bisa dihapus. Hapus itemnya dari riwayat.");
      }
      const [attachments] = await connection.query(`SELECT file_name FROM ${cfg.attachments} WHERE purchase_id = ?`, [purchaseId]);
      await connection.query(`DELETE FROM ${cfg.purchases} WHERE id = ?`, [purchaseId]);
      return attachments.map(row => row.file_name);
    });
    const dir = cfg.receiptDir || PURCHASE_RECEIPT_DIR;
    await Promise.all(files.map(name => fs.unlink(path.join(dir, name)).catch(() => {})));
    return { id: purchaseId };
  };

  // Edit (patch) or delete (remove) one line of a posted nota.
  const changeLine = async (lineId, { patch, remove = false }, user) => {
    lineId = number(lineId, 1, 4294967295, 0, "ID item belanja");
    const edit = patch ? normalizeItemPatch(patch, { unitRequired: !cfg.defaultUnit }) : null;
    return withTransaction(async connection => {
      const [[target]] = await connection.query(`SELECT * FROM ${cfg.items} WHERE id = ? FOR UPDATE`, [lineId]);
      if (!target) throw createError(404, "Item belanja tidak ditemukan.");
      if (!target[cfg.itemFk]) throw createError(400, cfg.unlinkedMessage);
      const [[header]] = await connection.query(`SELECT * FROM ${cfg.purchases} WHERE id = ? FOR UPDATE`, [target.purchase_id]);
      if (header.status !== "posted") throw createError(400, "Nota ini masih draft. Ubah lewat Draft Nota.");
      const [lines] = await connection.query(
        `SELECT * FROM ${cfg.items} WHERE purchase_id = ? ORDER BY id FOR UPDATE`,
        [header.id]
      );

      let edited = null;
      if (edit) {
        const [[stock]] = await connection.query(`SELECT unit FROM ${cfg.stockTable} WHERE id = ?`, [target[cfg.itemFk]]);
        const stockUnit = stock?.unit || target.stock_unit;
        const lineUnit = edit.unit || target.unit;
        edited = {
          ...target,
          quantity: edit.quantity,
          unit: lineUnit,
          unit_price: edit.unitPrice,
          total: roundCurrency(edit.quantity * edit.unitPrice),
          stock_quantity: convertQuantity(edit.quantity, lineUnit, stockUnit),
          stock_unit: stockUnit,
        };
      }
      const nextLines = lines
        .filter(line => !(remove && line.id === target.id))
        .map(line => (edited && line.id === target.id ? edited : line));
      const totals = computeNotaTotals(nextLines.map(line => Number(line.total)), adjustmentsFromHeader(header));

      // Stock moves by each line's quantity and cost difference.
      const deltas = new Map([[target[cfg.itemFk], { qty: 0, value: 0 }]]);
      lines.forEach(old => {
        const index = nextLines.findIndex(line => line.id === old.id);
        const qty = (index >= 0 ? Number(nextLines[index].stock_quantity) : 0) - Number(old.stock_quantity || 0);
        const value = (index >= 0 ? totals.costTotals[index] : 0) - Number(old.cost_total || 0);
        const stockId = old[cfg.itemFk];
        if (!stockId || (!qty && !value && stockId !== target[cfg.itemFk])) return;
        const delta = deltas.get(stockId) || { qty: 0, value: 0 };
        deltas.set(stockId, { qty: delta.qty + qty, value: delta.value + value });
      });
      const states = new Map();
      for (const stockId of [...deltas.keys()].sort((a, b) => a - b)) {
        const { qty, value } = deltas.get(stockId);
        const [[stock]] = await connection.query(`SELECT * FROM ${cfg.stockTable} WHERE id = ? FOR UPDATE`, [stockId]);
        if (!stock) throw createError(404, cfg.stockMissingMessage);
        const nextStock = Math.round((Number(stock.stock || 0) + qty) * 100) / 100;
        const nextValue = roundCurrency(Number(stock.stock_value || 0) + value);
        const nextAverageCost = nextStock > 0 ? roundCost(nextValue / nextStock) : 0;
        await connection.query(
          `UPDATE ${cfg.stockTable} SET stock = ?, stock_value = ?, unit_cost = ? WHERE id = ?`,
          [nextStock, nextValue, nextAverageCost, stockId]
        );
        states.set(stockId, { stockValue: nextValue, averageCost: nextAverageCost });
      }

      for (const [index, line] of nextLines.entries()) {
        if (line === edited) {
          const state = states.get(line[cfg.itemFk]);
          await connection.query(
            `UPDATE ${cfg.items}
             SET quantity = ?, unit = ?, unit_price = ?, total = ?, cost_total = ?,
                 stock_quantity = ?, stock_unit = ?, stock_unit_cost = ?, stock_value_after = ?
             WHERE id = ?`,
            [line.quantity, line.unit, line.unit_price, line.total, totals.costTotals[index],
              line.stock_quantity, line.stock_unit, state.averageCost, state.stockValue, line.id]
          );
        } else if (Number(line.cost_total) !== totals.costTotals[index]) {
          await connection.query(`UPDATE ${cfg.items} SET cost_total = ? WHERE id = ?`, [totals.costTotals[index], line.id]);
        }
      }
      if (remove) {
        if (cfg.logLine) {
          await cfg.logLine(connection, { line: target, action: "delete", oldData: cfg.snapshotLine(target), newData: null, user });
        }
        await connection.query(`DELETE FROM ${cfg.items} WHERE id = ?`, [target.id]);
      }
      await connection.query(
        `UPDATE ${cfg.purchases} SET subtotal = ?, shipping_cost = ?, discount_amount = ?, tax_amount = ?, total = ? WHERE id = ?`,
        [...footerColumns(totals), header.id]
      );
      await cfg.afterStock(connection, [...deltas.keys()]);
      await postPurchaseDifference(connection, {
        purchaseId: header.id,
        amount: Number(header.total) - totals.total,
        referenceType: remove ? cfg.referenceTypes.delete : cfg.referenceTypes.edit,
        purchaseReferenceType: cfg.referenceTypes.purchase,
        note: remove
          ? `Hapus ${target.item_name} dari ${cfg.label} #${header.id}`
          : `Ubah ${target.item_name} di ${cfg.label} #${header.id}`,
        user,
      });

      if (!edited) return cfg.snapshotLine(target);
      const [[updated]] = await connection.query(`SELECT * FROM ${cfg.items} WHERE id = ?`, [target.id]);
      const newData = cfg.snapshotLine(updated);
      if (cfg.logLine) {
        await cfg.logLine(connection, { line: target, action: "edit", oldData: cfg.snapshotLine(target), newData, user });
      }
      return newData;
    });
  };

  // Nota with their lines and bukti. Drafts carry what the form needs to open
  // them again; posted nota (posted) also their posting, what each line put
  // into stock and the COGS (and stock value) right after it, with the
  // kategori its barang has now (Lainnya).
  const describeNotas = async (headers, { posted = false } = {}) => {
    if (!headers.length) return [];
    const ids = headers.map(header => header.id);
    const placeholders = ids.map(() => "?").join(",");
    const [lines] = await db.query(
      `SELECT i.*${cfg.lineCategory ? ", COALESCE(s.category, i.category) AS current_category" : ""}
       FROM ${cfg.items} i
       LEFT JOIN ${cfg.stockTable} s ON s.id = i.${cfg.itemFk}
       WHERE i.purchase_id IN (${placeholders}) ORDER BY i.id`,
      ids
    );
    const [attachments] = await db.query(
      `SELECT id, purchase_id, original_name FROM ${cfg.attachments} WHERE purchase_id IN (${placeholders}) ORDER BY id`,
      ids
    );

    return headers.map(header => ({
      id: header.id,
      kind: cfg.kind,
      date: header.purchase_date,
      suplierId: header.suplier_id,
      supplierName: header.suplier_name,
      paymentSourceId: header.payment_source_id,
      paymentMethod: header.payment_method,
      note: header.note || "",
      subtotal: Number(header.subtotal),
      shippingCost: Number(header.shipping_cost),
      discountType: header.discount_type,
      discountValue: Number(header.discount_value),
      discountAmount: Number(header.discount_amount),
      taxPercent: Number(header.tax_percent),
      taxAmount: Number(header.tax_amount),
      total: Number(header.total),
      createdBy: header.created_by_name || "",
      createdAt: header.created_at,
      ...(posted && { postedBy: header.posted_by_name || "", postedAt: header.posted_at }),
      items: lines
        .filter(line => line.purchase_id === header.id)
        .map(line => ({
          id: line.id,
          [cfg.itemIdKey]: line[cfg.itemFk],
          itemName: line.item_name,
          ...(cfg.lineCategory && { category: posted ? line.current_category : line.category }),
          quantity: Number(line.quantity),
          unit: line.unit,
          unitPrice: Number(line.unit_price),
          total: Number(line.total),
          ...(posted && {
            costTotal: Number(line.cost_total ?? line.total),
            stockQuantity: Number(line.stock_quantity),
            stockUnit: line.stock_unit,
            stockAverageCost: Number(line.stock_unit_cost || 0),
            stockValueAfter: Number(line.stock_value_after || 0),
          }),
        })),
      attachments: attachments
        .filter(attachment => attachment.purchase_id === header.id)
        .map(attachment => ({ id: attachment.id, url: cfg.attachmentUrl(attachment.id), name: attachment.original_name })),
    }));
  };

  // Drafts waiting to be posted, newest first.
  const listDrafts = async () => {
    const [headers] = await db.query(
      `SELECT p.*, u.name AS created_by_name
       FROM ${cfg.purchases} p
       LEFT JOIN users u ON u.id = p.created_by
       WHERE p.status = 'draft'
       ORDER BY p.created_at DESC, p.id DESC`
    );
    return describeNotas(headers);
  };

  // The "Per Nota" history: posted nota, newest first, 10 per page. search
  // matches the toko or a barang (or kategori) on the nota; category (Lainnya)
  // keeps the nota holding a barang of that kategori, by its current one.
  // totalSpending is the Grand Total of every matching nota (all pages).
  // from/to keep a period (dateRange); pageSize (up to 1000) is for exports.
  const listPosted = async ({ page = 1, search = "", category = "", from, to, pageSize } = {}) => {
    page = Math.max(1, Math.floor(Number(page) || 1));
    const period = dateRange({ from, to });
    const size = pageSize == null || pageSize === "" ? NOTA_PAGE_SIZE : number(pageSize, 1, 1000, 0, "Jumlah per halaman");
    if (category && !cfg.categories?.includes(category)) {
      throw createError(400, cfg.categories ? `Kategori harus ${cfg.categories.join(", ")}.` : "Kategori tidak dikenal.");
    }
    const keyword = `%${String(search).slice(0, 150)}%`;
    const where = `p.status = 'posted'
       AND (p.suplier_name LIKE ? OR EXISTS (
         SELECT 1 FROM ${cfg.items} si WHERE si.purchase_id = p.id
           AND (si.item_name LIKE ?${cfg.lineCategory ? " OR si.category LIKE ?" : ""})))
       ${category ? `AND EXISTS (
         SELECT 1 FROM ${cfg.items} ci LEFT JOIN ${cfg.stockTable} cs ON cs.id = ci.${cfg.itemFk}
         WHERE ci.purchase_id = p.id AND COALESCE(cs.category, ci.category) = ?)` : ""}${period.sql}`;
    const params = [keyword, keyword, ...(cfg.lineCategory ? [keyword] : []), ...(category ? [category] : []), ...period.params];
    const [[count]] = await db.query(
      `SELECT COUNT(*) AS total, COALESCE(SUM(p.total), 0) AS spending FROM ${cfg.purchases} p WHERE ${where}`,
      params
    );
    const [headers] = await db.query(
      `SELECT p.*, u.name AS created_by_name, pu.name AS posted_by_name
       FROM ${cfg.purchases} p
       LEFT JOIN users u ON u.id = p.created_by
       LEFT JOIN users pu ON pu.id = p.posted_by
       WHERE ${where}
       ORDER BY p.purchase_date DESC, p.id DESC
       LIMIT ? OFFSET ?`,
      [...params, size, (page - 1) * size]
    );
    return {
      notas: await describeNotas(headers, { posted: true }),
      total: Number(count.total),
      totalSpending: Number(count.spending),
      page,
    };
  };

  return {
    create,
    updateDraft,
    removeDraft,
    listDrafts,
    listPosted,
    updateItem: (id, body, user) => changeLine(id, { patch: body || {} }, user),
    deleteItem: (id, user) => changeLine(id, { remove: true }, user),
  };
};

module.exports = { actor, createNotaEngine, dateRange, findOrCreateSupplier, itemFilter, postPurchaseDifference };
