const { pool } = require("../config/database");

const mapCategory = (row) => {
  if (!row) return null;

  return {
    _id: row.id,
    id: row.id,
    name: row.name,
    icon: row.icon,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const findAll = async ({ includeInactive = false } = {}) => {
  const [rows] = await pool.query(
    `SELECT * FROM categories
     ${includeInactive ? "" : "WHERE is_active = TRUE"}
     ORDER BY
       CASE name
         WHEN 'Coffee' THEN 1
         WHEN 'Non-Coffee' THEN 2
         WHEN 'Main Course' THEN 3
         WHEN 'Snack' THEN 4
         ELSE 99
       END,
       name ASC`
  );
  return rows.map(mapCategory);
};

const findById = async (id) => {
  const [rows] = await pool.query("SELECT * FROM categories WHERE id = ?", [
    id,
  ]);
  return mapCategory(rows[0]);
};

const create = async ({ name, icon }) => {
  const [result] = await pool.query(
    "INSERT INTO categories (name, icon) VALUES (?, ?)",
    [name, icon || null]
  );
  return findById(result.insertId);
};

const update = async (id, { name, icon, isActive }) => {
  await pool.query(
    `UPDATE categories
     SET name = ?, icon = ?, is_active = ?
     WHERE id = ?`,
    [name, icon || null, isActive ? 1 : 0, id]
  );
  return findById(id);
};

const remove = async (id) => {
  const [result] = await pool.query("DELETE FROM categories WHERE id = ?", [
    id,
  ]);
  return result.affectedRows > 0;
};

module.exports = { create, findAll, findById, remove, update };
