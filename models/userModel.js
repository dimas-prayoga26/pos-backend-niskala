const { pool } = require("../config/database");

const mapUser = (row) => {
  if (!row) return null;

  return {
    _id: row.id,
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    role: row.role,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const findByEmail = async (email) => {
  const [rows] = await pool.query("SELECT * FROM users WHERE email = ? LIMIT 1", [
    email,
  ]);
  return mapUser(rows[0]);
};

// Password hashes are available only to the authentication path.
const findByEmailForAuth = async (email) => {
  const [rows] = await pool.query("SELECT * FROM users WHERE email = ? LIMIT 1", [email]);
  if (!rows[0]) return null;
  return { ...mapUser(rows[0]), password: rows[0].password };
};

const findById = async (id) => {
  const [rows] = await pool.query("SELECT * FROM users WHERE id = ? LIMIT 1", [
    id,
  ]);
  return mapUser(rows[0]);
};

const findAll = async () => {
  const [rows] = await pool.query(
    `SELECT id, name, phone, email, role, created_at, updated_at
     FROM users
     ORDER BY name ASC`
  );

  return rows.map(mapUser);
};

const create = async ({ name, phone, email, password, role }) => {
  const [result] = await pool.query(
    "INSERT INTO users (name, phone, email, password, role) VALUES (?, ?, ?, ?, ?)",
    [name, phone, email, password, role]
  );

  return findById(result.insertId);
};

module.exports = { create, findAll, findByEmail, findByEmailForAuth, findById, mapUser };
