const { pool } = require("../config/database");

const mapAddOn = (row) => {
  if (!row) return null;

  return {
    _id: row.id,
    id: row.id,
    code: row.code,
    name: row.name,
    price: Number(row.price),
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const toCode = (value) =>
  String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const baseQuery = `
  SELECT ao.*
  FROM add_ons ao
`;

const findAll = async () => {
  const [rows] = await pool.query(
    `${baseQuery}
     WHERE ao.is_active = TRUE
     ORDER BY ao.name ASC`
  );
  return rows.map(mapAddOn);
};

const findByCategoryId = async () => findAll();

const findById = async (id) => {
  const [rows] = await pool.query(`${baseQuery} WHERE ao.id = ? LIMIT 1`, [id]);
  return mapAddOn(rows[0]);
};

const create = async ({ code, name, price, isActive = true }) => {
  const [result] = await pool.query(
    `INSERT INTO add_ons (code, name, price, is_active)
     VALUES (?, ?, ?, ?)`,
    [toCode(code || name), name, price || 0, isActive ? 1 : 0]
  );
  return findById(result.insertId);
};

const update = async (id, { code, name, price, isActive = true }) => {
  await pool.query(
    `UPDATE add_ons
     SET code = ?, name = ?, price = ?, is_active = ?
     WHERE id = ?`,
    [toCode(code || name), name, price || 0, isActive ? 1 : 0, id]
  );
  return findById(id);
};

const remove = async (id) => {
  const [result] = await pool.query("DELETE FROM add_ons WHERE id = ?", [id]);
  return result.affectedRows > 0;
};

module.exports = { create, findAll, findByCategoryId, findById, remove, update };
