const { pool } = require("../../infrastructure/database/pool");
const {
  normalizeIngredients,
  normalizeSizes,
  normalizeVariants,
} = require("./menu.options");

const mapMenuItem = (row) => {
  if (!row) return null;

  const regularPriceValue = row.regular_price ?? row.price;
  const regularPrice =
    regularPriceValue === null || regularPriceValue === undefined
      ? null
      : Number(regularPriceValue);
  const onlinePrice =
    row.online_price === null || row.online_price === undefined
      ? null
      : Number(row.online_price);
  const hppCost = row.hpp_cost === null ? null : Number(row.hpp_cost || 0);
  const grossProfit =
    row.gross_profit === null ? null : Number(row.gross_profit || 0);

  return {
    _id: row.id,
    id: row.id,
    categoryId: row.category_id,
    name: row.name,
    price: regularPrice,
    regularPrice,
    onlinePrice,
    includeOnlinePlatform: Boolean(row.include_online_platform),
    largePrice: null,
    hppCost,
    hpp: hppCost,
    grossProfit,
    profit: grossProfit,
    ingredients: [],
    variants: [],
    sizes: [],
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
    c.name AS category_name,
    c.icon AS category_icon,
    c.tax AS category_tax,
    c.sort_order AS category_sort_order
  FROM menu_items mi
  JOIN categories c ON c.id = mi.category_id
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

const attachOptions = async (menuItems) => {
  if (!menuItems.length) return menuItems;

  const ids = menuItems.map((item) => item.id);
  const placeholders = ids.map(() => "?").join(", ");
  const [sizeRows] = await pool.query(
    `SELECT menu_item_id, name, price, hpp_cost, gross_profit
     FROM menu_item_sizes
     WHERE menu_item_id IN (${placeholders})
     ORDER BY sort_order ASC, id ASC`,
    ids
  );
  const [variantRows] = await pool.query(
    `SELECT menu_item_id, name
     FROM menu_item_variants
     WHERE menu_item_id IN (${placeholders})
     ORDER BY sort_order ASC, id ASC`,
    ids
  );
  const [ingredientRows] = await pool.query(
    `SELECT
       mii.*,
       si.name AS stock_item_name
     FROM menu_item_ingredients mii
     LEFT JOIN stock_items si ON si.id = mii.stock_item_id
     WHERE mii.menu_item_id IN (${placeholders})
     ORDER BY mii.sort_order ASC, mii.id ASC`,
    ids
  );

  const sizesByMenuItemId = new Map();
  const variantsByMenuItemId = new Map();
  const ingredientsByMenuItemId = new Map();

  for (const row of sizeRows) {
    if (!sizesByMenuItemId.has(row.menu_item_id)) {
      sizesByMenuItemId.set(row.menu_item_id, []);
    }

    sizesByMenuItemId.get(row.menu_item_id).push({
      name: row.name,
      price: Number(row.price),
      hppCost: Number(row.hpp_cost || 0),
      hpp: Number(row.hpp_cost || 0),
      grossProfit: Number(row.gross_profit || 0),
      profit: Number(row.gross_profit || 0),
    });
  }

  for (const row of variantRows) {
    if (!variantsByMenuItemId.has(row.menu_item_id)) {
      variantsByMenuItemId.set(row.menu_item_id, []);
    }

    variantsByMenuItemId.get(row.menu_item_id).push(row.name);
  }

  for (const row of ingredientRows) {
    if (!ingredientsByMenuItemId.has(row.menu_item_id)) {
      ingredientsByMenuItemId.set(row.menu_item_id, []);
    }

    ingredientsByMenuItemId.get(row.menu_item_id).push({
      _id: row.id,
      id: row.id,
      stockItemId: row.stock_item_id,
      stockItemName: row.stock_item_name,
      sizeName: row.size_name || "",
      ingredientName: row.ingredient_name,
      name: row.ingredient_name,
      quantity: Number(row.quantity),
      unit: row.unit,
      note: row.note || "",
    });
  }

  return menuItems.map((item) => {
    const sizes = sizesByMenuItemId.get(item.id) || [];
    const variants = variantsByMenuItemId.get(item.id) || [];
    const ingredients = ingredientsByMenuItemId.get(item.id) || [];
    const primarySize = sizes[0];

    return {
      ...item,
      price: primarySize?.price ?? item.price,
      regularPrice: primarySize?.price ?? item.regularPrice,
      largePrice:
        sizes.find((size) => size.name.toLowerCase() === "large")?.price ??
        sizes[1]?.price ??
        null,
      hppCost: primarySize?.hppCost ?? item.hppCost,
      hpp: primarySize?.hpp ?? item.hpp,
      grossProfit: primarySize?.grossProfit ?? item.grossProfit,
      profit: primarySize?.profit ?? item.profit,
      sizes,
      variants,
      ingredients,
    };
  });
};

// Replaces sizes and variants; ingredients only when an array is supplied.
const replaceOptions = async (
  connection,
  menuItemId,
  { sizes, variants, ingredients }
) => {
  const normalizedSizes = normalizeSizes(sizes);
  const normalizedVariants = normalizeVariants(variants);
  const shouldReplaceIngredients = Array.isArray(ingredients);
  const normalizedIngredients = shouldReplaceIngredients
    ? normalizeIngredients(ingredients)
    : [];

  await connection.query("DELETE FROM menu_item_sizes WHERE menu_item_id = ?", [
    menuItemId,
  ]);
  await connection.query(
    "DELETE FROM menu_item_variants WHERE menu_item_id = ?",
    [menuItemId]
  );
  if (shouldReplaceIngredients) {
    await connection.query(
      "DELETE FROM menu_item_ingredients WHERE menu_item_id = ?",
      [menuItemId]
    );
  }

  if (normalizedSizes.length) {
    await connection.query(
      `INSERT INTO menu_item_sizes
        (menu_item_id, name, price, hpp_cost, gross_profit, sort_order)
       VALUES ?`,
      [
        normalizedSizes.map((size, index) => [
          menuItemId,
          size.name,
          size.price,
          size.hppCost,
          size.grossProfit,
          index + 1,
        ]),
      ]
    );
  }

  if (normalizedVariants.length) {
    await connection.query(
      `INSERT INTO menu_item_variants (menu_item_id, name, sort_order)
       VALUES ?`,
      [
        normalizedVariants.map((variant, index) => [
          menuItemId,
          variant,
          index + 1,
        ]),
      ]
    );
  }

  if (shouldReplaceIngredients && normalizedIngredients.length) {
    await connection.query(
      `INSERT INTO menu_item_ingredients
        (menu_item_id, stock_item_id, size_name, ingredient_name, quantity, unit,
         sort_order, note)
       VALUES ?`,
      [
        normalizedIngredients.map((ingredient, index) => [
          menuItemId,
          ingredient.stockItemId || null,
          ingredient.sizeName || null,
          ingredient.ingredientName,
          ingredient.quantity,
          ingredient.unit,
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
  return attachOptions(rows.map(mapMenuItem));
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
  return attachOptions(rows.map(mapMenuItem));
};

const findById = async (id) => {
  const [rows] = await pool.query(`${baseQuery} WHERE mi.id = ? LIMIT 1`, [id]);
  const [menuItem] = await attachOptions(rows.map(mapMenuItem).filter(Boolean));
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

const excludeFromDefaultSeed = async (names) => {
  const normalizedNames = [...new Set(
    (Array.isArray(names) ? names : [names])
      .map((name) => String(name || "").trim())
      .filter(Boolean)
  )];

  if (!normalizedNames.length) return;

  await pool.query(
    "INSERT IGNORE INTO menu_seed_exclusions (name) VALUES ?",
    [normalizedNames.map((name) => [name])]
  );
};

const insertMenuItem = async (
  connection,
  {
    categoryId,
    name,
    basePrice,
    baseOnlinePrice,
    shouldIncludeOnlinePlatform,
    profitFields,
    imagePath,
    isAvailable,
  }
) => {
  const [result] = await connection.query(
    `INSERT INTO menu_items
      (category_id, name, regular_price, online_price, include_online_platform,
       hpp_cost, gross_profit, image_path,
       is_available)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      categoryId,
      name,
      basePrice,
      baseOnlinePrice,
      shouldIncludeOnlinePlatform ? 1 : 0,
      profitFields.hppCost,
      profitFields.grossProfit,
      imagePath || null,
      isAvailable ? 1 : 0,
    ]
  );

  return result.insertId;
};

const updateMenuItem = async (
  connection,
  id,
  {
    categoryId,
    name,
    basePrice,
    baseOnlinePrice,
    shouldIncludeOnlinePlatform,
    profitFields,
    imagePath,
    isAvailable,
  }
) => {
  await connection.query(
    `UPDATE menu_items
     SET category_id = ?,
         name = ?,
         regular_price = ?,
         online_price = ?,
         include_online_platform = ?,
         hpp_cost = ?,
         gross_profit = ?,
         image_path = ?,
         is_available = ?
     WHERE id = ?`,
    [
      categoryId,
      name,
      basePrice,
      baseOnlinePrice,
      shouldIncludeOnlinePlatform ? 1 : 0,
      profitFields.hppCost,
      profitFields.grossProfit,
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
  excludeFromDefaultSeed,
  findAll,
  findByCategoryId,
  findById,
  insertMenuItem,
  remove,
  replaceOptions,
  updateMenuItem,
};
