const { pool } = require("../config/database");

const mapOrder = (row, items = []) => {
  if (!row) return null;

  return {
    _id: row.id,
    id: row.id,
    orderId: row.order_code,
    orderCode: row.order_code,
    customerDetails: {
      name: row.customer_name,
      guests: row.guests,
    },
    orderStatus: row.order_status,
    orderDate: row.order_date,
    bills: {
      total: Number(row.total),
      tax: Number(row.tax),
      totalWithTax: Number(row.total_with_tax),
    },
    items,
    paymentMethod: row.payment_method,
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
  name: row.name,
  variant: row.variant,
  quantity: row.quantity,
  pricePerQuantity: Number(row.price_per_quantity),
  price: Number(row.price),
  addOns: row.addOns || [],
});

const mapAddOn = (row) => ({
  id: row.add_on_code || row.add_on_id || row.id,
  _id: row.add_on_id,
  code: row.add_on_code,
  name: row.name,
  price: Number(row.price),
});

const getAddOnCode = (addOn) =>
  String(addOn.code || addOn.id || addOn.name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const findItemsByOrderIds = async (orderIds) => {
  if (!orderIds.length) return new Map();

  const [rows] = await pool.query(
    `SELECT * FROM order_items WHERE order_id IN (?) ORDER BY id ASC`,
    [orderIds]
  );
  const addOnsByOrderItemId = await findAddOnsByOrderItemIds(
    rows.map((row) => row.id)
  );
  const itemsByOrderId = new Map();

  rows.forEach((row) => {
    if (!itemsByOrderId.has(row.order_id)) {
      itemsByOrderId.set(row.order_id, []);
    }
    itemsByOrderId.get(row.order_id).push(
      mapItem({
        ...row,
        addOns: addOnsByOrderItemId.get(row.id) || [],
      })
    );
  });

  return itemsByOrderId;
};

const findAddOnsByOrderItemIds = async (orderItemIds) => {
  if (!orderItemIds.length) return new Map();

  const [rows] = await pool.query(
    `SELECT
       oia.order_item_id,
       oia.add_on_id,
       ao.code AS add_on_code,
       oia.name,
       oia.price
     FROM order_item_addons oia
     LEFT JOIN add_ons ao ON ao.id = oia.add_on_id
     WHERE oia.order_item_id IN (?)
     ORDER BY oia.id ASC`,
    [orderItemIds]
  );
  const addOnsByOrderItemId = new Map();

  rows.forEach((row) => {
    if (!addOnsByOrderItemId.has(row.order_item_id)) {
      addOnsByOrderItemId.set(row.order_item_id, []);
    }
    addOnsByOrderItemId.get(row.order_item_id).push(mapAddOn(row));
  });

  return addOnsByOrderItemId;
};

const baseOrderQuery = `
  SELECT
    o.*,
    oot.midtrans_order_id AS online_midtrans_order_id,
    oot.midtrans_transaction_id AS online_midtrans_transaction_id,
    oot.midtrans_payment_type AS online_midtrans_payment_type,
    oot.midtrans_transaction_status AS online_midtrans_transaction_status
  FROM orders o
  LEFT JOIN order_online_transactions oot ON oot.order_id = o.id
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
      orderStatus,
      bills,
      items = [],
      paymentMethod,
      paymentData = {},
    } = orderData;

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
        (customer_name, guests, order_status, total, tax, total_with_tax,
         payment_method)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        customerName,
        customerDetails.guests,
        orderStatus,
        bills.total,
        bills.tax,
        bills.totalWithTax,
        paymentMethod,
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

    for (const item of items) {
      const [itemResult] = await connection.query(
        `INSERT INTO order_items
          (order_id, item_key, name, variant, quantity, price_per_quantity, price)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          orderId,
          item.id || null,
          item.name,
          item.variant || null,
          item.quantity,
          item.pricePerQuantity,
          item.price,
        ]
      );

      const orderItemId = itemResult.insertId;

      for (const addOn of item.addOns || []) {
        const code = getAddOnCode(addOn);

        const [addOnResult] = await connection.query(
          `INSERT INTO add_ons (code, name, price)
           VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE
             name = VALUES(name),
             price = VALUES(price),
             id = LAST_INSERT_ID(id)`,
          [code, addOn.name, addOn.price || 0]
        );

        await connection.query(
          `INSERT INTO order_item_addons
            (order_item_id, add_on_id, name, price)
           VALUES (?, ?, ?, ?)`,
          [orderItemId, addOnResult.insertId, addOn.name, addOn.price || 0]
        );
      }
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
  await pool.query("UPDATE orders SET order_status = ? WHERE id = ?", [
    orderStatus,
    id,
  ]);
  return findById(id);
};

module.exports = { create, findAll, findById, updateStatus };
