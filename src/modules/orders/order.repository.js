const { pool } = require("../../infrastructure/database/pool");

// Catering paid amount: Full plans count as fully paid, DP plans use dp_received.
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
      phone: row.customer_phone || "",
    },
    orderType: row.order_type || "Offline",
    orderPlatform: row.order_platform_name || "",
    orderPlatformId: row.order_platform_meta_id || null,
    platformTax: Number(row.order_platform_tax || 0),
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const mapItem = (row) => ({
  id: row.item_key || row.id,
  _id: row.id,
  menuItemId: row.menu_item_id,
  sourceMenuItemId: row.menu_item_id,
  name: row.name,
  variant: row.variant,
  quantity: row.quantity,
  pricePerQuantity: Number(row.price_per_quantity),
  hppCost: Number(row.hpp_cost || 0),
  hpp: Number(row.hpp_cost || 0),
  price: Number(row.price),
  addOns: row.addOns || [],
});

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
    op.meta_data_platform_id AS order_platform_meta_id,
    op.platform_name AS order_platform_name,
    op.platform_tax AS order_platform_tax,
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
  LEFT JOIN order_platforms op ON op.order_id = o.id
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

// --- writes (all run on the caller's connection) ----------------------------

// Guests are numbered per order day: Guest-1, Guest-2, ...
const countGuestOrdersOnDate = async (connection, orderDate) => {
  const [guestRows] = await connection.query(
    `SELECT COUNT(*) AS total
     FROM orders
     WHERE DATE(order_date) = DATE(${orderDate ? "?" : "CURRENT_DATE()"})
       AND (customer_name = 'Guest' OR customer_name REGEXP '^Guest-[0-9]+$')`,
    orderDate ? [orderDate] : []
  );

  return Number(guestRows[0]?.total || 0);
};

const insertOrder = async (
  connection,
  {
    customerName,
    customerPhone,
    orderType,
    orderStatus,
    orderDate,
    bills,
    paymentMethod,
    note,
  }
) => {
  const orderDateExpression = orderDate
    ? "TIMESTAMP(?, CURRENT_TIME())"
    : "CURRENT_TIMESTAMP";
  const orderDateParams = orderDate ? [orderDate] : [];
  const [result] = await connection.query(
    `INSERT INTO orders
      (customer_name, customer_phone, order_type, order_status, order_date, total, online_order_charge, tax, total_with_tax,
       payment_method, note)
     VALUES (?, ?, ?, ?, ${orderDateExpression}, ?, ?, ?, ?, ?, ?)`,
    [
      customerName,
      customerPhone || null,
      orderType,
      orderStatus,
      ...orderDateParams,
      bills.total,
      bills.onlineOrderCharge || 0,
      bills.tax,
      bills.totalWithTax,
      paymentMethod,
      note || null,
    ]
  );

  return result.insertId;
};

const setOrderCode = (connection, orderId, orderCode) =>
  connection.query("UPDATE orders SET order_code = ? WHERE id = ?", [
    orderCode,
    orderId,
  ]);

const insertOrderPlatform = (connection, orderId, platformSnapshot) =>
  connection.query(
    `INSERT INTO order_platforms
      (order_id, meta_data_platform_id, platform_name, platform_tax)
     VALUES (?, ?, ?, ?)`,
    [
      orderId,
      platformSnapshot.id,
      platformSnapshot.name,
      platformSnapshot.tax,
    ]
  );

const insertCateringDetails = (
  connection,
  orderId,
  { cateringDetails, paymentPlan, dpReceived, isPaid }
) =>
  connection.query(
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
      paymentPlan,
      dpReceived,
      isPaid ? 1 : 0,
      cateringDetails.note || null,
    ]
  );

const insertOrderItem = async (connection, orderId, { item, menuItemSnapshot }) => {
  const [result] = await connection.query(
    `INSERT INTO order_items
      (order_id, item_key, menu_item_id, name, variant, quantity,
       price_per_quantity, hpp_cost, price)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      orderId,
      item.id || null,
      menuItemSnapshot.menuItemId,
      item.name,
      item.variant || null,
      item.quantity,
      item.pricePerQuantity,
      menuItemSnapshot.hppCost,
      item.price,
    ]
  );

  return result.insertId;
};

// Per-ingredient HPP frozen at sale time (see order_item_costs).
const insertOrderItemCosts = async (connection, orderItemId, costs = []) => {
  if (!costs.length) return;

  await connection.query(
    `INSERT INTO order_item_costs
      (order_item_id, stock_item_id, stock_item_name, quantity, unit, unit_cost, cost)
     VALUES ?`,
    [
      costs.map((line) => [
        orderItemId,
        line.stockItemId,
        line.stockItemName,
        line.quantity,
        line.unit,
        line.unitCost,
        line.cost,
      ]),
    ]
  );
};

const updateStatus = (connection, id, orderStatus) =>
  connection.query("UPDATE orders SET order_status = ? WHERE id = ?", [
    orderStatus,
    id,
  ]);

// Marking paid settles the full total; marking unpaid keeps dp_received.
const setCateringPaidStatus = async (connection, id, isPaid) => {
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

  return result.affectedRows > 0;
};

// Payments are capped at the order total; reaching it marks the order paid.
const addCateringPayment = async (connection, id, amount) => {
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

  return result.affectedRows > 0;
};

const orderExists = async (connection, id) => {
  const [orderRows] = await connection.query(
    "SELECT id FROM orders WHERE id = ? LIMIT 1",
    [id]
  );

  return orderRows.length > 0;
};

const findItemsForStockRestore = async (connection, id) => {
  const [itemRows] = await connection.query(
    `SELECT
       item_key AS id,
       menu_item_id AS menuItemId,
       quantity
     FROM order_items
     WHERE order_id = ?`,
    [id]
  );

  return itemRows;
};

const deleteOrder = async (connection, id) => {
  const [result] = await connection.query("DELETE FROM orders WHERE id = ?", [
    id,
  ]);

  return result.affectedRows > 0;
};

module.exports = {
  addCateringPayment,
  countGuestOrdersOnDate,
  deleteOrder,
  findAll,
  findById,
  findItemsForStockRestore,
  insertCateringDetails,
  insertOrder,
  insertOrderItem,
  insertOrderItemCosts,
  insertOrderPlatform,
  orderExists,
  setCateringPaidStatus,
  setOrderCode,
  updateStatus,
};
