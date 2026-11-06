const { pool, withTransaction } = require("../../infrastructure/database/pool");

const mapCategory = (row) => {
  if (!row) return null;

  return {
    _id: row.id,
    id: row.id,
    name: row.name,
    icon: row.icon,
    tax: row.tax === null || row.tax === undefined ? null : Number(row.tax),
    taxRate: row.tax === null || row.tax === undefined ? null : Number(row.tax),
    // Kategori Promo: its menus are packages of other menus, not bahan.
    isBundle: Boolean(row.is_bundle),
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

const create = async ({ name, icon, taxRate, isBundle = false }) => {
  const [sortRows] = await pool.query(
    "SELECT COALESCE(MAX(sort_order), 0) + 10 AS next_sort_order FROM categories"
  );
  const sortOrder = Number(sortRows[0]?.next_sort_order) || 10;
  const [result] = await pool.query(
    "INSERT INTO categories (name, icon, tax, is_bundle, sort_order) VALUES (?, ?, ?, ?, ?)",
    [name, icon || null, taxRate ?? null, isBundle ? 1 : 0, sortOrder]
  );
  return findById(result.insertId);
};

// Toggling a category's status also toggles availability of all its menu
// items. isBundle undefined keeps the category's Kategori Promo flag.
const update = async (id, { name, icon, taxRate, isActive, isBundle }) => {
  await withTransaction(async (connection) => {
    const [existingRows] = await connection.query(
      "SELECT is_active, is_bundle FROM categories WHERE id = ? FOR UPDATE",
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

    const normalizedIsBundle =
      isBundle === undefined ? Boolean(existingCategory?.is_bundle) : Boolean(isBundle);

    await connection.query(
      `UPDATE categories
       SET name = ?, icon = ?, tax = ?, is_active = ?, is_bundle = ?
       WHERE id = ?`,
      [name, icon || null, taxRate ?? null, normalizedIsActive, normalizedIsBundle ? 1 : 0, id]
    );

    if (statusChanged) {
      await connection.query(
        `UPDATE menu_items
         SET is_available = ?
         WHERE category_id = ?`,
        [normalizedIsActive, id]
      );
    }
  });

  return findById(id);
};

const updatePositions = async (categoryIds) => {
  await withTransaction(async (connection) => {
    for (const [index, categoryId] of categoryIds.entries()) {
      await connection.query(
        "UPDATE categories SET sort_order = ? WHERE id = ?",
        [(index + 1) * 10, categoryId]
      );
    }
  });

  return findAll({ includeInactive: true });
};

const remove = async (id) => {
  const [result] = await pool.query("DELETE FROM categories WHERE id = ?", [
    id,
  ]);
  return result.affectedRows > 0;
};

// Packages of other categories that contain a menu of this category or offer
// a choice of it; they block deleting it (the menus go with the category).
const findBundleNamesUsing = async (id) => {
  const [rows] = await pool.query(
    `SELECT b.name
     FROM menu_item_bundle_items bi
     JOIN menu_items m ON m.id = bi.menu_item_id
     JOIN menu_items b ON b.id = bi.bundle_menu_item_id
     WHERE m.category_id = ? AND b.category_id <> ?
     UNION
     SELECT b.name
     FROM menu_item_bundle_choices bc
     JOIN menu_items b ON b.id = bc.bundle_menu_item_id
     WHERE bc.category_id = ?
     ORDER BY name ASC`,
    [id, id, id]
  );
  return rows.map((row) => row.name);
};

// Packages offering a choice of this category; it cannot become a Kategori
// Promo while they do.
const findChoiceBundleNames = async (id) => {
  const [rows] = await pool.query(
    `SELECT DISTINCT b.name
     FROM menu_item_bundle_choices bc
     JOIN menu_items b ON b.id = bc.bundle_menu_item_id
     WHERE bc.category_id = ?
     ORDER BY b.name ASC`,
    [id]
  );
  return rows.map((row) => row.name);
};

module.exports = {
  create,
  findAll,
  findBundleNamesUsing,
  findChoiceBundleNames,
  remove,
  update,
  updatePositions,
};
