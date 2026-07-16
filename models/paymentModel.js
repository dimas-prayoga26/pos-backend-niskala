const { pool } = require("../config/database");

const create = async ({
  paymentId,
  orderId,
  amount,
  currency,
  status,
  method,
  email,
  contact,
  createdAt,
}) => {
  const [result] = await pool.query(
    `INSERT INTO payments
      (payment_id, order_id, amount, currency, status, method, email, contact, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      paymentId,
      orderId,
      amount,
      currency,
      status,
      method,
      email,
      contact,
      createdAt || new Date(),
    ]
  );

  return { _id: result.insertId, id: result.insertId };
};

module.exports = { create };
