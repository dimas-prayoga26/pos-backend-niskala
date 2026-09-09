const { pool } = require("../config/database");

const parseNominal = (value) => {
  if (typeof value === "string") {
    const digitsOnly = value.replace(/\D/g, "");

    return Number(digitsOnly) || 0;
  }

  return Number(value) || 0;
};

const mapOrderPlatform = (row) => {
  if (!row) return null;

  return {
    _id: row.id,
    id: row.id,
    name: row.name,
    iconUrl: row.icon_url,
    tax: Number(row.tax || 0),
    taxRate: Number(row.tax || 0),
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const findAll = async ({ includeInactive = false } = {}) => {
  const [rows] = await pool.query(
    `SELECT *
     FROM meta_data_platform
     ${includeInactive ? "" : "WHERE is_active = TRUE"}
     ORDER BY name ASC`
  );

  return rows.map(mapOrderPlatform);
};

const findById = async (id) => {
  const [rows] = await pool.query("SELECT * FROM meta_data_platform WHERE id = ?", [
    id,
  ]);

  return mapOrderPlatform(rows[0]);
};

const create = async ({ name, iconUrl, tax = 0, isActive = true }) => {
  const [result] = await pool.query(
    `INSERT INTO meta_data_platform (name, icon_url, tax, is_active)
     VALUES (?, ?, ?, ?)`,
    [name, iconUrl || null, parseNominal(tax), isActive ? 1 : 0]
  );

  return findById(result.insertId);
};

const update = async (id, { name, iconUrl, tax = 0, isActive = true }) => {
  await pool.query(
    `UPDATE meta_data_platform
     SET name = ?, icon_url = ?, tax = ?, is_active = ?
     WHERE id = ?`,
    [name, iconUrl || null, parseNominal(tax), isActive ? 1 : 0, id]
  );

  return findById(id);
};

const deactivate = async (id) => {
  const [result] = await pool.query(
    "UPDATE meta_data_platform SET is_active = FALSE WHERE id = ?",
    [id]
  );

  return result.affectedRows > 0;
};

module.exports = { create, deactivate, findAll, findById, update };
