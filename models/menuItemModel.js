const { pool } = require("../config/database");

const mapMenuItem = (row) => {
  if (!row) return null;

  return {
    _id: row.id,
    id: row.id,
    categoryId: row.category_id,
    name: row.name,
    price: Number(row.price),
    imageUrl: row.image_url,
    isAvailable: Boolean(row.is_available),
    category: row.category_name
      ? {
          _id: row.category_id,
          id: row.category_id,
          name: row.category_name,
          icon: row.category_icon,
        }
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const baseQuery = `
  SELECT
    mi.*,
    c.name AS category_name,
    c.icon AS category_icon
  FROM menu_items mi
  JOIN categories c ON c.id = mi.category_id
`;

const categoryOrder = `
  CASE c.name
    WHEN 'Coffee' THEN 1
    WHEN 'Non-Coffee' THEN 2
    WHEN 'Main Course' THEN 3
    WHEN 'Snack' THEN 4
    ELSE 99
  END
`;

const menuItemOrder = `
  CASE mi.name
    WHEN 'Espresso' THEN 1
    WHEN 'Americano' THEN 2
    WHEN 'Cappuccino' THEN 3
    WHEN 'Latte' THEN 4
    WHEN 'Lemon Coffee' THEN 5
    WHEN 'Palm Sugar Coffee' THEN 6
    WHEN 'Tubruk Robusta' THEN 7
    WHEN 'Tubruk Arabika' THEN 8
    WHEN 'Strawberry Yakult' THEN 9
    WHEN 'Taro' THEN 10
    WHEN 'Matcha' THEN 11
    WHEN 'Chocolate' THEN 12
    WHEN 'Tea' THEN 13
    WHEN 'Lemon Tea' THEN 14
    WHEN 'Strawberry Tea' THEN 15
    WHEN 'Thai Tea' THEN 16
    WHEN 'Fried Egg Rice Bowl' THEN 17
    WHEN 'Chicken Katsu Rice Bowl' THEN 18
    WHEN 'Chicken Teriyaki Rice Bowl' THEN 19
    WHEN 'Ayam Geprek Rice Bowl' THEN 20
    WHEN 'Beef Teriyaki Rice Bowl' THEN 21
    WHEN 'Indomie Goreng Telur' THEN 22
    WHEN 'Indomie Rebus Telur' THEN 23
    WHEN 'Kentang Goreng' THEN 24
    WHEN 'Mix Platter' THEN 25
    WHEN 'Cireng' THEN 26
    WHEN 'Pisang Nugget Keju Coklat' THEN 27
    WHEN 'Roti Bakar' THEN 28
    ELSE 99
  END
`;

const findAll = async ({ includeUnavailable = false } = {}) => {
  const [rows] = await pool.query(
    `${baseQuery}
     ${includeUnavailable ? "" : "WHERE mi.is_available = TRUE AND c.is_active = TRUE"}
     ORDER BY ${categoryOrder}, ${menuItemOrder}, mi.name ASC`
  );
  return rows.map(mapMenuItem);
};

const findByCategoryId = async (
  categoryId,
  { includeUnavailable = false } = {}
) => {
  const [rows] = await pool.query(
    `${baseQuery}
     WHERE mi.category_id = ?
       ${includeUnavailable ? "" : "AND mi.is_available = TRUE AND c.is_active = TRUE"}
     ORDER BY ${menuItemOrder}, mi.name ASC`,
    [categoryId]
  );
  return rows.map(mapMenuItem);
};

const findById = async (id) => {
  const [rows] = await pool.query(`${baseQuery} WHERE mi.id = ? LIMIT 1`, [id]);
  return mapMenuItem(rows[0]);
};

const create = async ({
  categoryId,
  name,
  price,
  imageUrl,
  isAvailable = true,
}) => {
  const [result] = await pool.query(
    `INSERT INTO menu_items
      (category_id, name, price, image_url, is_available)
     VALUES (?, ?, ?, ?, ?)`,
    [
      categoryId,
      name,
      price,
      imageUrl || null,
      isAvailable ? 1 : 0,
    ]
  );
  return findById(result.insertId);
};

const update = async (
  id,
  { categoryId, name, price, imageUrl, isAvailable }
) => {
  await pool.query(
    `UPDATE menu_items
     SET category_id = ?, name = ?, price = ?, image_url = ?, is_available = ?
     WHERE id = ?`,
    [
      categoryId,
      name,
      price,
      imageUrl || null,
      isAvailable ? 1 : 0,
      id,
    ]
  );
  return findById(id);
};

const remove = async (id) => {
  const [result] = await pool.query("DELETE FROM menu_items WHERE id = ?", [
    id,
  ]);
  return result.affectedRows > 0;
};

module.exports = {
  create,
  findAll,
  findByCategoryId,
  findById,
  remove,
  update,
};
