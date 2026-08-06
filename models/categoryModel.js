const { pool } = require("../config/database");

const mapCategory = (row) => {
  if (!row) return null;

  return {
    _id: row.id,
    id: row.id,
    name: row.name,
    icon: row.icon,
    tax: row.tax === null || row.tax === undefined ? null : Number(row.tax),
    taxRate: row.tax === null || row.tax === undefined ? null : Number(row.tax),
    isActive: Boolean(row.is_active),
    sortOrder: Number(row.sort_order || 0),
    position: Number(row.sort_order || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const findAll = async ({ includeInactive = false } = {}) => {
  const [rows] = await pool.query(
    `SELECT * FROM categories
     ${includeInactive ? "" : "WHERE is_active = TRUE"}
     ORDER BY
       CASE WHEN sort_order > 0 THEN sort_order ELSE 9999 END,
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

const create = async ({ name, icon, taxRate }) => {
  const [sortRows] = await pool.query(
    "SELECT COALESCE(MAX(sort_order), 0) + 10 AS next_sort_order FROM categories"
  );
  const sortOrder = Number(sortRows[0]?.next_sort_order) || 10;
  const [result] = await pool.query(
    "INSERT INTO categories (name, icon, tax, sort_order) VALUES (?, ?, ?, ?)",
    [name, icon || null, taxRate ?? null, sortOrder]
  );
  return findById(result.insertId);
};

const update = async (id, { name, icon, taxRate, isActive }) => {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const [existingRows] = await connection.query(
      "SELECT is_active FROM categories WHERE id = ? FOR UPDATE",
      [id]
    );
    const existingCategory = existingRows[0];
    const normalizedIsActive =
      isActive === undefined
        ? (existingCategory?.is_active ? 1 : 0)
        : (isActive ? 1 : 0);
    const statusChanged =
      existingCategory &&
      Boolean(existingCategory.is_active) !== Boolean(normalizedIsActive);

    await connection.query(
      `UPDATE categories
       SET name = ?, icon = ?, tax = ?, is_active = ?
       WHERE id = ?`,
      [name, icon || null, taxRate ?? null, normalizedIsActive, id]
    );

    if (statusChanged) {
      await connection.query(
        `UPDATE menu_items
         SET is_available = ?
         WHERE category_id = ?`,
        [normalizedIsActive, id]
      );
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  return findById(id);
};

const updatePositions = async (categoryIds) => {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    for (const [index, categoryId] of categoryIds.entries()) {
      await connection.query(
        "UPDATE categories SET sort_order = ? WHERE id = ?",
        [(index + 1) * 10, categoryId]
      );
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  return findAll({ includeInactive: true });
};

const remove = async (id) => {
  const [result] = await pool.query("DELETE FROM categories WHERE id = ?", [
    id,
  ]);
  return result.affectedRows > 0;
};

module.exports = { create, findAll, findById, remove, update, updatePositions };
