const { pool } = require("../config/database");

const mapOrderPlatform = (row) => {
  if (!row) return null;

  return {
    _id: row.id,
    id: row.id,
    name: row.name,
    iconUrl: row.icon_url,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const findAll = async ({ includeInactive = false } = {}) => {
  const [rows] = await pool.query(
    `SELECT *
     FROM order_platforms
     ${includeInactive ? "" : "WHERE is_active = TRUE"}
     ORDER BY name ASC`
  );

  return rows.map(mapOrderPlatform);
};

const findById = async (id) => {
  const [rows] = await pool.query("SELECT * FROM order_platforms WHERE id = ?", [
    id,
  ]);

  return mapOrderPlatform(rows[0]);
};

const create = async ({ name, iconUrl, isActive = true }) => {
  const [result] = await pool.query(
    `INSERT INTO order_platforms (name, icon_url, is_active)
     VALUES (?, ?, ?)`,
    [name, iconUrl || null, isActive ? 1 : 0]
  );

  return findById(result.insertId);
};

const update = async (id, { name, iconUrl, isActive = true }) => {
  await pool.query(
    `UPDATE order_platforms
     SET name = ?, icon_url = ?, is_active = ?
     WHERE id = ?`,
    [name, iconUrl || null, isActive ? 1 : 0, id]
  );

  return findById(id);
};

const deactivate = async (id) => {
  const [result] = await pool.query(
    "UPDATE order_platforms SET is_active = FALSE WHERE id = ?",
    [id]
  );

  return result.affectedRows > 0;
};

module.exports = { create, deactivate, findAll, findById, update };
