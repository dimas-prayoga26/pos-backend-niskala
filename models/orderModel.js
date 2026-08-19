const { pool } = require("../config/database");

const mapOrder = (row, items = []) => {
  if (!row) return null;

  const totalWithTax = Number(row.total_with_tax);
  const cateringPaymentPlan = row.catering_payment_plan || "Full";
  const rawCateringPaid = Number(row.catering_dp_received || 0);
  const cateringPaidAmount =
    row.catering_order_id && cateringPaymentPlan !== "DP"
      ? totalWithTax
      : rawCateringPaid;

  return {
    _id: row.id,
    id: row.id,
    orderId: row.order_code,
    orderCode: row.order_code,
    customerDetails: {
      name: row.customer_name,
      guests: row.guests,
    },
    orderType: row.order_type || "Offline",
    orderPlatform: row.order_platform || "",
    orderStatus: row.order_status,
    orderDate: row.order_date,
    bills: {
      total: Number(row.total),
      onlineOrderCharge: Number(row.online_order_charge || 0),
      tax: Number(row.tax),
      totalWithTax,
      dp: cateringPaidAmount,
      remainingBalance: Math.max(
        totalWithTax - cateringPaidAmount,
        0
      ),
    },
    items,
    paymentMethod: row.payment_method,
    note: row.note || "",
    cateringDetails: row.catering_order_id
      ? {
          institution: row.catering_institution || "",
          whatsapp: row.catering_whatsapp || "",
          orderDate: row.catering_order_date,
          eventDate: row.catering_event_date,
          deliveryTime: row.catering_delivery_time,
          paymentPlan: cateringPaymentPlan,
          dp: cateringPaidAmount,
          isPaid: Math.max(totalWithTax - cateringPaidAmount, 0) === 0,
          note: row.catering_note || "",
        }
      : null,
    paymentData: {
      midtrans_order_id: row.online_midtrans_order_id,
      midtrans_transaction_id: row.online_midtrans_transaction_id,
      midtrans_payment_type: row.online_midtrans_payment_type,
      midtrans_transaction_status: row.online_midtrans_transaction_status,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const mapItem = (row) => ({
  id: row.item_key || row.id,
  _id: row.id,
  menuItemId: row.menu_item_id,
  sourceMenuItemId: row.menu_item_id,
  sizeName: row.size_name || "",
  sizeVariant: row.size_name || "",
  name: row.name,
  variant: row.variant,
  quantity: row.quantity,
  pricePerQuantity: Number(row.price_per_quantity),
  hppCost: Number(row.hpp_cost || 0),
  hpp: Number(row.hpp_cost || 0),
  price: Number(row.price),
  addOns: row.addOns || [],
});

const getSourceMenuItemId = (item) => {
  const directId = Number(
    item.sourceMenuItemId || item.menuItemSourceId || item.menuId
  );

  if (Number.isFinite(directId) && directId > 0) return directId;

  const menuItemId = Number(item.menuItemId);
  if (Number.isFinite(menuItemId) && menuItemId > 0) return menuItemId;

  const [categoryId, parsedMenuItemId] = String(item.id || "")
    .split("-")
    .map(Number);

  if (
    Number.isFinite(categoryId) &&
    Number.isFinite(parsedMenuItemId) &&
    parsedMenuItemId > 0
  ) {
    return parsedMenuItemId;
  }

  return null;
};

const findMenuItemSnapshot = async (connection, menuItemId, sizeName = "") => {
  if (!menuItemId) return { menuItemId: null, hppCost: 0 };

  const [rows] = await connection.query(
    `SELECT mi.id,
            COALESCE(
       (
         SELECT mis.hpp_cost
         FROM menu_item_sizes mis
         WHERE mis.menu_item_id = mi.id
           AND LOWER(mis.name) = LOWER(?)
         LIMIT 1
       ),
       (
         SELECT mis.hpp_cost
         FROM menu_item_sizes mis
         WHERE mis.menu_item_id = mi.id
         ORDER BY mis.sort_order ASC, mis.id ASC
         LIMIT 1
       ),
       mi.hpp_cost,
       0
     ) AS hpp_cost
     FROM menu_items mi
     WHERE mi.id = ?
     LIMIT 1`,
    [sizeName, menuItemId]
  );

  if (!rows.length) return { menuItemId: null, hppCost: 0 };

  return {
    menuItemId: rows[0].id,
    hppCost: Number(rows[0].hpp_cost || 0),
  };
};

const createStockValidationError = (insufficientStock) => {
  const error = new Error("Stok bahan tidak mencukupi.");
  error.statusCode = 409;
  error.details = { insufficientStock };

  return error;
};

const createRecapLockedError = (
  message = "Pesanan sudah masuk rekap harian dan tidak bisa diubah."
) => {
  const error = new Error(message);
  error.statusCode = 409;

  return error;
};

const assertNoDailyRecapForDate = async (connection, dateExpression, message) => {
  const [rows] = await connection.query(
    `SELECT dr.id
     FROM daily_recaps dr
     WHERE dr.recap_date = DATE(${dateExpression})
     LIMIT 1`
  );

  if (rows.length) {
    throw createRecapLockedError(message);
  }
};

const assertOrderIsNotRecapped = async (connection, orderId) => {
  const [rows] = await connection.query(
    `SELECT dr.id
     FROM orders o
     JOIN daily_recaps dr ON dr.recap_date = DATE(o.order_date)
     WHERE o.id = ?
     LIMIT 1`,
    [orderId]
  );

  if (rows.length) {
    throw createRecapLockedError();
  }
};

const normalizeOrderItemsForStock = (items = []) =>
  items
    .map((item) => ({
      menuItemId: getSourceMenuItemId(item),
      sizeName: String(item.sizeVariant || item.sizeName || "").trim(),
      quantity: Math.max(Number(item.quantity) || 0, 0),
    }))
    .filter((item) => item.menuItemId && item.quantity > 0);

const buildStockDeductions = async (connection, items = []) => {
  const orderItems = items
    ? normalizeOrderItemsForStock(items)
    : [];

  if (!orderItems.length) return new Map();

  const menuItemIds = [...new Set(orderItems.map((item) => item.menuItemId))];
  const [ingredientRows] = await connection.query(
    `SELECT
       mii.menu_item_id,
       mii.stock_item_id,
       mii.size_name,
       mii.quantity,
       si.name AS stock_name,
       si.stock,
       si.unit,
       si.is_unlimited
     FROM menu_item_ingredients mii
     JOIN stock_items si ON si.id = mii.stock_item_id
     WHERE mii.menu_item_id IN (?)
       AND mii.stock_item_id IS NOT NULL`,
    [menuItemIds]
  );

  if (!ingredientRows.length) return new Map();

  const deductions = new Map();

  for (const orderItem of orderItems) {
    const matchingIngredients = ingredientRows.filter((ingredient) => {
      if (Number(ingredient.menu_item_id) !== orderItem.menuItemId) return false;

      const ingredientSizeName = String(ingredient.size_name || "").trim();

      return (
        !ingredientSizeName ||
        (orderItem.sizeName &&
          ingredientSizeName.toLowerCase() === orderItem.sizeName.toLowerCase())
      );
    });

    for (const ingredient of matchingIngredients) {
      const stockItemId = Number(ingredient.stock_item_id);
      const deduction =
        (Number(ingredient.quantity) || 0) * orderItem.quantity;

      if (!stockItemId || deduction <= 0) continue;

      const currentDeduction = deductions.get(stockItemId) || {
        stockItemId,
        name: ingredient.stock_name,
        stock: Number(ingredient.stock || 0),
        unit: ingredient.unit || "",
        isUnlimited: Boolean(ingredient.is_unlimited),
        required: 0,
      };

      currentDeduction.required += deduction;
      deductions.set(stockItemId, currentDeduction);
    }
  }

  return deductions;
};

const getInsufficientStock = (deductions) =>
  Array.from(deductions.values())
    .filter(
      (deduction) =>
        !deduction.isUnlimited && deduction.required > deduction.stock
    )
    .map((deduction) => ({
      stockItemId: deduction.stockItemId,
      name: deduction.name,
      stock: deduction.stock,
      required: deduction.required,
      shortage: deduction.required - deduction.stock,
      unit: deduction.unit,
    }));

const applyStockDeductions = async (connection, deductions) => {
  for (const deduction of deductions.values()) {
    await connection.query(
      `UPDATE stock_items
       SET stock = CASE
         WHEN is_unlimited = TRUE THEN stock
         ELSE stock - ?
       END
       WHERE id = ?`,
      [deduction.required, deduction.stockItemId]
    );
  }

  return deductions.size;
};

const deductIngredientStock = async (
  connection,
  items = [],
  { allowNegativeStock = false } = {}
) => {
  const deductions = await buildStockDeductions(connection, items);
  if (!deductions.size) return 0;

  const insufficientStock = getInsufficientStock(deductions);
  if (insufficientStock.length && !allowNegativeStock) {
    throw createStockValidationError(insufficientStock);
  }

  return applyStockDeductions(connection, deductions);
};

const restoreIngredientStock = async (connection, items = []) => {
  const deductions = await buildStockDeductions(connection, items);
  if (!deductions.size) return 0;

  for (const deduction of deductions.values()) {
    await connection.query(
      `UPDATE stock_items
       SET stock = CASE
         WHEN is_unlimited = TRUE THEN stock
         ELSE stock + ?
       END
       WHERE id = ?`,
      [deduction.required, deduction.stockItemId]
    );
  }

  return deductions.size;
};

const findItemsByOrderIds = async (orderIds) => {
  if (!orderIds.length) return new Map();

  const [rows] = await pool.query(
    `SELECT * FROM order_items WHERE order_id IN (?) ORDER BY id ASC`,
    [orderIds]
  );
  const itemsByOrderId = new Map();

  rows.forEach((row) => {
    if (!itemsByOrderId.has(row.order_id)) {
      itemsByOrderId.set(row.order_id, []);
    }
    itemsByOrderId.get(row.order_id).push(
      mapItem(row)
    );
  });

  return itemsByOrderId;
};

const baseOrderQuery = `
  SELECT
    o.*,
    oot.midtrans_order_id AS online_midtrans_order_id,
    oot.midtrans_transaction_id AS online_midtrans_transaction_id,
    oot.midtrans_payment_type AS online_midtrans_payment_type,
    oot.midtrans_transaction_status AS online_midtrans_transaction_status,
    cod.order_id AS catering_order_id,
    cod.institution AS catering_institution,
    cod.whatsapp AS catering_whatsapp,
    cod.order_date AS catering_order_date,
    cod.event_date AS catering_event_date,
    cod.delivery_time AS catering_delivery_time,
    cod.payment_plan AS catering_payment_plan,
    cod.dp_received AS catering_dp_received,
    cod.is_paid AS catering_is_paid,
    cod.note AS catering_note
  FROM orders o
  LEFT JOIN order_online_transactions oot ON oot.order_id = o.id
  LEFT JOIN order_catering_details cod ON cod.order_id = o.id
`;

const findAll = async () => {
  const [rows] = await pool.query(`${baseOrderQuery} ORDER BY o.created_at DESC`);
  const itemsByOrderId = await findItemsByOrderIds(rows.map((row) => row.id));
  return rows.map((row) => mapOrder(row, itemsByOrderId.get(row.id) || []));
};

const findById = async (id) => {
  const [rows] = await pool.query(`${baseOrderQuery} WHERE o.id = ? LIMIT 1`, [
    id,
  ]);
  const order = rows[0];

  if (!order) return null;

  const itemsByOrderId = await findItemsByOrderIds([order.id]);
  return mapOrder(order, itemsByOrderId.get(order.id) || []);
};

const create = async (orderData) => {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const {
      customerDetails,
      orderType = "Offline",
      orderPlatform,
      orderStatus,
      bills,
      items = [],
      paymentMethod,
      paymentData = {},
      cateringDetails,
      allowNegativeStock = false,
      note = "",
    } = orderData;

    await assertNoDailyRecapForDate(
      connection,
      "CURRENT_DATE()",
      "Rekap harian hari ini sudah dibuat. Pesanan baru tidak bisa ditambahkan ke tanggal yang sudah closing."
    );

    await deductIngredientStock(connection, items, { allowNegativeStock });

    let customerName = String(customerDetails.name || "").trim();

    if (!customerName || customerName.toLowerCase() === "guest") {
      const [guestRows] = await connection.query(
        `SELECT COUNT(*) AS total
         FROM orders
         WHERE DATE(order_date) = CURDATE()
           AND (customer_name = 'Guest' OR customer_name REGEXP '^Guest-[0-9]+$')`
      );

      customerName = `Guest-${Number(guestRows[0]?.total || 0) + 1}`;
    }

    const [result] = await connection.query(
      `INSERT INTO orders
        (customer_name, guests, order_type, order_platform, order_status, total, online_order_charge, tax, total_with_tax,
         payment_method, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        customerName,
        customerDetails.guests || 1,
        orderType,
        orderType === "Online" ? orderPlatform || null : null,
        orderStatus,
        bills.total,
        bills.onlineOrderCharge || 0,
        bills.tax,
        bills.totalWithTax,
        paymentMethod,
        note || null,
      ]
    );

    const orderId = result.insertId;
    const orderCode = `ORD-${String(orderId).padStart(6, "0")}`;

    await connection.query("UPDATE orders SET order_code = ? WHERE id = ?", [
      orderCode,
      orderId,
    ]);

    if (
      paymentData.midtrans_order_id ||
      paymentData.midtrans_transaction_id ||
      paymentData.midtrans_payment_type ||
      paymentData.midtrans_transaction_status
    ) {
      await connection.query(
        `INSERT INTO order_online_transactions
          (order_id, midtrans_order_id, midtrans_transaction_id,
           midtrans_payment_type, midtrans_transaction_status)
         VALUES (?, ?, ?, ?, ?)`,
        [
          orderId,
          paymentData.midtrans_order_id || null,
          paymentData.midtrans_transaction_id || null,
          paymentData.midtrans_payment_type || null,
          paymentData.midtrans_transaction_status || null,
        ]
      );
    }

    if (cateringDetails) {
      const cateringPaymentPlan = cateringDetails.paymentPlan || "Full";
      const cateringDpReceived =
        cateringPaymentPlan === "Full"
          ? Number(bills.totalWithTax || 0)
          : Number(cateringDetails.dp || 0);
      const isPaid =
        Boolean(cateringDetails.isPaid) ||
        cateringDpReceived >= Number(bills.totalWithTax || 0);

      await connection.query(
        `INSERT INTO order_catering_details
          (order_id, institution, whatsapp, order_date, event_date,
           delivery_time, payment_plan, dp_received, is_paid, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          orderId,
          cateringDetails.institution || null,
          cateringDetails.whatsapp || null,
          cateringDetails.orderDate || null,
          cateringDetails.eventDate || null,
          cateringDetails.deliveryTime || null,
          cateringPaymentPlan,
          cateringDpReceived,
          isPaid ? 1 : 0,
          cateringDetails.note || null,
        ]
      );
    }

    for (const item of items) {
      const sourceMenuItemId = getSourceMenuItemId(item);
      const sizeName = String(item.sizeVariant || item.sizeName || "").trim();
      const menuItemSnapshot = await findMenuItemSnapshot(
        connection,
        sourceMenuItemId,
        sizeName
      );

      await connection.query(
        `INSERT INTO order_items
          (order_id, item_key, menu_item_id, size_name, name, variant, quantity,
           price_per_quantity, hpp_cost, price)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          orderId,
          item.id || null,
          menuItemSnapshot.menuItemId,
          sizeName || null,
          item.name,
          item.variant || null,
          item.quantity,
          item.pricePerQuantity,
          menuItemSnapshot.hppCost,
          item.price,
        ]
      );
    }

    await connection.commit();
    const order = await findById(orderId);
    return order;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const updateStatus = async (id, orderStatus) => {
  const connection = await pool.getConnection();

  try {
    await assertOrderIsNotRecapped(connection, id);
    await connection.query("UPDATE orders SET order_status = ? WHERE id = ?", [
      orderStatus,
      id,
    ]);
    return findById(id);
  } finally {
    connection.release();
  }
};

const updateCateringPaidStatus = async (id, isPaid) => {
  const connection = await pool.getConnection();

  try {
    await assertOrderIsNotRecapped(connection, id);
    const [result] = await connection.query(
      `UPDATE order_catering_details cod
       JOIN orders o ON o.id = cod.order_id
       SET
         cod.is_paid = ?,
         cod.dp_received = CASE
           WHEN ? = 1 THEN o.total_with_tax
           ELSE cod.dp_received
         END
       WHERE cod.order_id = ?`,
      [isPaid ? 1 : 0, isPaid ? 1 : 0, id]
    );

    if (!result.affectedRows) return null;

    return findById(id);
  } finally {
    connection.release();
  }
};

const addCateringPayment = async (id, amount) => {
  const connection = await pool.getConnection();

  try {
    await assertOrderIsNotRecapped(connection, id);
    const [result] = await connection.query(
      `UPDATE order_catering_details cod
       JOIN orders o ON o.id = cod.order_id
       SET
         cod.dp_received = LEAST(cod.dp_received + ?, o.total_with_tax),
         cod.is_paid = CASE
           WHEN LEAST(cod.dp_received + ?, o.total_with_tax) >= o.total_with_tax
           THEN 1
           ELSE 0
         END
       WHERE cod.order_id = ?`,
      [amount, amount, id]
    );

    if (!result.affectedRows) return null;

    return findById(id);
  } finally {
    connection.release();
  }
};

const updateCateringPaymentAmount = async (id, amount) => {
  const [result] = await pool.query(
    `UPDATE order_catering_details cod
     JOIN orders o ON o.id = cod.order_id
     SET
       cod.dp_received = LEAST(?, o.total_with_tax),
       cod.is_paid = CASE
         WHEN LEAST(?, o.total_with_tax) >= o.total_with_tax
         THEN 1
         ELSE 0
       END
     WHERE cod.order_id = ?`,
    [amount, amount, id]
  );

  if (!result.affectedRows) return null;

  return findById(id);
};

const remove = async (id) => {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [orderRows] = await connection.query(
      "SELECT id FROM orders WHERE id = ? LIMIT 1",
      [id]
    );

    if (!orderRows.length) {
      await connection.rollback();
      return false;
    }

    await assertOrderIsNotRecapped(connection, id);

    const [itemRows] = await connection.query(
      `SELECT
         item_key AS id,
         menu_item_id AS menuItemId,
         size_name AS sizeName,
         quantity
       FROM order_items
       WHERE order_id = ?`,
      [id]
    );

    await restoreIngredientStock(connection, itemRows);

    const [result] = await connection.query("DELETE FROM orders WHERE id = ?", [
      id,
    ]);

    await connection.commit();
    return result.affectedRows > 0;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

module.exports = {
  create,
  findAll,
  findById,
  updateStatus,
  updateCateringPaidStatus,
  addCateringPayment,
  updateCateringPaymentAmount,
  remove,
};
