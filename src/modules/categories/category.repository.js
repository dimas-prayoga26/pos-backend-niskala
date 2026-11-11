const { pool, withTransaction } = require("../../infrastructure/database/pool");
const createHttpError = require("http-errors");
const { bestSellerGroupOf } = require("./bestSeller");

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
    // Makanan, Minuman, Snack or null: its tab in Best Seller on Home.
    bestSellerGroup: bestSellerGroupOf({
      group: row.best_seller_group,
      name: row.name,
      isBundle: row.is_bundle,
    }),
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

// Pengaturan → Best Seller: groups maps Makanan/Minuman/Snack to category ids;
// every other category is not shown ('').
const updateBestSellerGroups = async (groups) => {
  const ids = Object.values(groups).flat();
  await withTransaction(async (connection) => {
    if (ids.length) {
      const [rows] = await connection.query("SELECT id FROM categories WHERE id IN (?) FOR UPDATE", [ids]);
      if (rows.length !== ids.length) {
        throw createHttpError(400, "Kategori tidak ditemukan. Muat ulang halaman.");
      }
    }
    await connection.query("UPDATE categories SET best_seller_group = ''");
    for (const [group, categoryIds] of Object.entries(groups)) {
      if (!categoryIds.length) continue;
      await connection.query("UPDATE categories SET best_seller_group = ? WHERE id IN (?)", [group, categoryIds]);
    }
  });

  return findAll({ includeInactive: true });
};

// A package's choice of this category that lists its own menus keeps working
// without it: the category's name stays as the choice's label.
const remove = async (id) =>
  withTransaction(async (connection) => {
    await connection.query(
      `UPDATE menu_item_bundle_choices bc
       JOIN categories c ON c.id = bc.category_id
       SET bc.label = c.name
       WHERE bc.category_id = ? AND bc.label IS NULL`,
      [id]
    );
    const [result] = await connection.query("DELETE FROM categories WHERE id = ?", [id]);
    return result.affectedRows > 0;
  });

// Packages of other categories that contain or offer a menu of this category;
// they block deleting it (the menus go with the category).
const findBundleNamesUsing = async (id) => {
  const [rows] = await pool.query(
    `SELECT b.name
     FROM menu_item_bundle_items bi
     JOIN menu_items m ON m.id = bi.menu_item_id
     JOIN menu_items b ON b.id = bi.bundle_menu_item_id
     WHERE m.category_id = ? AND b.category_id <> ?
     UNION
     SELECT b.name
     FROM menu_item_bundle_choice_menus bcm
     JOIN menu_items m ON m.id = bcm.menu_item_id
     JOIN menu_item_bundle_choices bc ON bc.id = bcm.bundle_choice_id
     JOIN menu_items b ON b.id = bc.bundle_menu_item_id
     WHERE m.category_id = ? AND b.category_id <> ?
     ORDER BY name ASC`,
    [id, id, id, id]
  );
  return rows.map((row) => row.name);
};

// Packages whose choice of this category offers every menu of it (no menus
// of its own); without the category it would offer nothing.
const findWholeCategoryChoiceBundleNames = async (id) => {
  const [rows] = await pool.query(
    `SELECT DISTINCT b.name
     FROM menu_item_bundle_choices bc
     JOIN menu_items b ON b.id = bc.bundle_menu_item_id
     WHERE bc.category_id = ?
       AND NOT EXISTS (SELECT 1 FROM menu_item_bundle_choice_menus o WHERE o.bundle_choice_id = bc.id)
     ORDER BY b.name ASC`,
    [id]
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
  findWholeCategoryChoiceBundleNames,
  remove,
  update,
  updateBestSellerGroups,
  updatePositions,
};
