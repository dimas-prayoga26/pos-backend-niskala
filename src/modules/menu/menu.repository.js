const { pool } = require("../../infrastructure/database/pool");
const {
  PRICE_ROW_COLUMNS,
  normalizeIngredients,
  toPriceRow,
} = require("./menu.options");

const toNullableNumber = (value) =>
  value === null || value === undefined ? null : Number(value);

// Price fields come from menu_item_prices; all are null without a price row.
const mapMenuItem = (row) => {
  if (!row) return null;

  const regularPrice = toNullableNumber(row.regular_price);
  const hppCost = toNullableNumber(row.hpp_cost);
  const grossProfit = toNullableNumber(row.gross_profit);

  return {
    _id: row.id,
    id: row.id,
    categoryId: row.category_id,
    name: row.name,
    price: regularPrice,
    regularPrice,
    onlinePrice: toNullableNumber(row.online_price),
    includeOnlinePlatform: Boolean(row.include_online_platform),
    hppCost,
    hpp: hppCost,
    grossProfit,
    profit: grossProfit,
    ingredients: [],
    imagePath: row.image_path,
    isAvailable: Boolean(row.is_available),
    category: row.category_name
      ? {
          _id: row.category_id,
          id: row.category_id,
          name: row.category_name,
          icon: row.category_icon,
          tax: row.category_tax === null ? null : Number(row.category_tax),
          taxRate: row.category_tax === null ? null : Number(row.category_tax),
          sortOrder: Number(row.category_sort_order || 0),
          position: Number(row.category_sort_order || 0),
        }
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const baseQuery = `
  SELECT
    mi.*,
    mip.regular_price,
    mip.online_price,
    mip.hpp_cost,
    mip.gross_profit,
    c.name AS category_name,
    c.icon AS category_icon,
    c.tax AS category_tax,
    c.sort_order AS category_sort_order
  FROM menu_items mi
  JOIN categories c ON c.id = mi.category_id
  LEFT JOIN menu_item_prices mip ON mip.menu_item_id = mi.id
`;

const categoryOrder = `
  CASE WHEN c.sort_order > 0 THEN c.sort_order ELSE 9999 END
`;

const menuItemOrder = `
  CASE mi.name
    WHEN 'Cappuccino' THEN 1
    WHEN 'Cafe Latte' THEN 2
    WHEN 'Butterscotch Latte' THEN 3
    WHEN 'Caramel Latte' THEN 4
    WHEN 'Vanilla Latte' THEN 5
    WHEN 'Hazelnut Latte' THEN 6
    WHEN 'Aren Latte' THEN 7
    WHEN 'Moccacino' THEN 8
    WHEN 'Berry Coffee Milk' THEN 9
    WHEN 'Americano' THEN 10
    WHEN 'Longblack' THEN 11
    WHEN 'On The Rock Espresso' THEN 12
    WHEN 'Tropical Americano' THEN 13
    WHEN 'Elberry Americano' THEN 14
    WHEN 'Berry Summer' THEN 15
    WHEN 'Chocolate' THEN 16
    WHEN 'Matcha' THEN 17
    WHEN 'Cookies and Cream' THEN 18
    WHEN 'Lychee Tea' THEN 19
    WHEN 'Lemon Tea' THEN 20
    WHEN 'Jeruk Nipis Songkit' THEN 21
    WHEN 'Thai Tea' THEN 22
    WHEN 'Fried Egg Rice Bowl' THEN 23
    WHEN 'Chicken Katsu Rice Bowl' THEN 24
    WHEN 'Chicken Teriyaki Rice Bowl' THEN 25
    WHEN 'Ayam Geprek Rice Bowl' THEN 26
    WHEN 'Beef Teriyaki Rice Bowl' THEN 27
    WHEN 'Indomie Goreng Telur' THEN 28
    WHEN 'Indomie Rebus Telur' THEN 29
    WHEN 'Kentang Goreng' THEN 30
    WHEN 'Mix Platter' THEN 31
    WHEN 'Cireng' THEN 32
    WHEN 'Pisang Nugget Keju Coklat' THEN 33
    WHEN 'Roti Bakar' THEN 34
    ELSE 99
  END
`;

const attachRecipes = async (menuItems) => {
  if (!menuItems.length) return menuItems;

  const ids = menuItems.map((item) => item.id);
  const [ingredientRows] = await pool.query(
    `SELECT
       r.*,
       COALESCE(si.name, ss.name) AS stock_item_name,
       COALESCE(si.unit, ss.unit) AS stock_unit
     FROM recipes r
     LEFT JOIN stock_raw_items si ON si.id = r.stock_item_id
     LEFT JOIN stock_semi_items ss ON ss.id = r.semi_item_id
     WHERE r.menu_item_id IN (?)
       AND (si.id IS NOT NULL OR ss.id IS NOT NULL)
     ORDER BY r.sort_order ASC, r.id ASC`,
    [ids]
  );

  const ingredientsByMenuItemId = new Map();

  for (const row of ingredientRows) {
    if (!ingredientsByMenuItemId.has(row.menu_item_id)) {
      ingredientsByMenuItemId.set(row.menu_item_id, []);
    }

    ingredientsByMenuItemId.get(row.menu_item_id).push({
      _id: row.id,
      id: row.id,
      stockItemId: row.stock_item_id,
      semiItemId: row.semi_item_id,
      stockItemName: row.stock_item_name,
      ingredientName: row.stock_item_name,
      name: row.stock_item_name,
      quantity: Number(row.quantity),
      unit: row.stock_unit,
      note: row.note || "",
    });
  }

  return menuItems.map((item) => ({
    ...item,
    ingredients: ingredientsByMenuItemId.get(item.id) || [],
  }));
};

// Replaces the price row; recipe rows only when an ingredients array is supplied.
const replacePriceAndRecipe = async (
  connection,
  menuItemId,
  { price, ingredients }
) => {
  await connection.query("DELETE FROM menu_item_prices WHERE menu_item_id = ?", [
    menuItemId,
  ]);

  const priceRow = toPriceRow(menuItemId, price);
  if (priceRow) {
    await connection.query(
      `INSERT INTO menu_item_prices ${PRICE_ROW_COLUMNS} VALUES (?)`,
      [priceRow]
    );
  }

  if (!Array.isArray(ingredients)) return;

  const normalizedIngredients = normalizeIngredients(ingredients);
  await connection.query("DELETE FROM recipes WHERE menu_item_id = ?", [
    menuItemId,
  ]);

  if (normalizedIngredients.length) {
    await connection.query(
      `INSERT INTO recipes
        (menu_item_id, stock_item_id, semi_item_id, quantity, sort_order, note)
       VALUES ?`,
      [
        normalizedIngredients.map((ingredient, index) => [
          menuItemId,
          ingredient.stockItemId,
          ingredient.semiItemId,
          ingredient.quantity,
          index + 1,
          ingredient.note || null,
        ]),
      ]
    );
  }
};

const findAll = async ({ includeUnavailable = false } = {}) => {
  const [rows] = await pool.query(
    `${baseQuery}
     ${includeUnavailable ? "" : "WHERE mi.is_available = TRUE AND c.is_active = TRUE"}
     ORDER BY ${categoryOrder}, ${menuItemOrder}, mi.name ASC`
  );
  return attachRecipes(rows.map(mapMenuItem));
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
  return attachRecipes(rows.map(mapMenuItem));
};

const findById = async (id) => {
  const [rows] = await pool.query(`${baseQuery} WHERE mi.id = ? LIMIT 1`, [id]);
  const [menuItem] = await attachRecipes(rows.map(mapMenuItem).filter(Boolean));
  return menuItem || null;
};

const countImagePathReferences = async (imagePath) => {
  if (!imagePath) return 0;

  const [rows] = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM menu_items WHERE image_path = ?) AS total`,
    [imagePath]
  );

  return Number(rows[0]?.total) || 0;
};

const insertMenuItem = async (
  connection,
  { categoryId, name, shouldIncludeOnlinePlatform, imagePath, isAvailable }
) => {
  const [result] = await connection.query(
    `INSERT INTO menu_items
      (category_id, name, include_online_platform, image_path, is_available)
     VALUES (?, ?, ?, ?, ?)`,
    [
      categoryId,
      name,
      shouldIncludeOnlinePlatform ? 1 : 0,
      imagePath || null,
      isAvailable ? 1 : 0,
    ]
  );

  return result.insertId;
};

const updateMenuItem = async (
  connection,
  id,
  { categoryId, name, shouldIncludeOnlinePlatform, imagePath, isAvailable }
) => {
  await connection.query(
    `UPDATE menu_items
     SET category_id = ?,
         name = ?,
         include_online_platform = ?,
         image_path = ?,
         is_available = ?
     WHERE id = ?`,
    [
      categoryId,
      name,
      shouldIncludeOnlinePlatform ? 1 : 0,
      imagePath || null,
      isAvailable ? 1 : 0,
      id,
    ]
  );
};

const remove = async (id) => {
  const [result] = await pool.query("DELETE FROM menu_items WHERE id = ?", [
    id,
  ]);
  return result.affectedRows > 0;
};

module.exports = {
  countImagePathReferences,
  findAll,
  findByCategoryId,
  findById,
  insertMenuItem,
  remove,
  replacePriceAndRecipe,
  updateMenuItem,
};
