const { pool } = require("../config/database");

const normalizeSize = (size) => ({
  name: String(size?.name || "").trim(),
  price: Number(size?.price) || 0,
});

const normalizeSizes = (sizes) =>
  (Array.isArray(sizes) ? sizes : [])
    .map(normalizeSize)
    .filter((size) => size.name && size.price >= 0);

const normalizeVariants = (variants) =>
  (Array.isArray(variants) ? variants : [])
    .map((variant) => String(variant || "").trim())
    .filter(Boolean);

const mapMenuItem = (row) => {
  if (!row) return null;

  return {
    _id: row.id,
    id: row.id,
    categoryId: row.category_id,
    name: row.name,
    price: Number(row.price),
    regularPrice: Number(row.price),
    largePrice: null,
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
    c.tax AS category_tax
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
    `SELECT menu_item_id, name, price
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

  const sizesByMenuItemId = new Map();
  const variantsByMenuItemId = new Map();

  for (const row of sizeRows) {
    if (!sizesByMenuItemId.has(row.menu_item_id)) {
      sizesByMenuItemId.set(row.menu_item_id, []);
    }

    sizesByMenuItemId.get(row.menu_item_id).push({
      name: row.name,
      price: Number(row.price),
    });
  }

  for (const row of variantRows) {
    if (!variantsByMenuItemId.has(row.menu_item_id)) {
      variantsByMenuItemId.set(row.menu_item_id, []);
    }

    variantsByMenuItemId.get(row.menu_item_id).push(row.name);
  }

  return menuItems.map((item) => {
    const sizes = sizesByMenuItemId.get(item.id) || [];
    const variants = variantsByMenuItemId.get(item.id) || [];

    return {
      ...item,
      regularPrice: sizes[0]?.price ?? item.price,
      largePrice:
        sizes.find((size) => size.name.toLowerCase() === "large")?.price ??
        sizes[1]?.price ??
        null,
      sizes,
      variants,
    };
  });
};

const replaceOptions = async (connection, menuItemId, { sizes, variants }) => {
  const normalizedSizes = normalizeSizes(sizes);
  const normalizedVariants = normalizeVariants(variants);

  await connection.query("DELETE FROM menu_item_sizes WHERE menu_item_id = ?", [
    menuItemId,
  ]);
  await connection.query(
    "DELETE FROM menu_item_variants WHERE menu_item_id = ?",
    [menuItemId]
  );

  if (normalizedSizes.length) {
    await connection.query(
      `INSERT INTO menu_item_sizes (menu_item_id, name, price, sort_order)
       VALUES ?`,
      [
        normalizedSizes.map((size, index) => [
          menuItemId,
          size.name,
          size.price,
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

const create = async ({
  categoryId,
  name,
  price,
  regularPrice,
  largePrice,
  variants = [],
  sizes = [],
  imagePath,
  isAvailable = true,
}) => {
  const normalizedSizes = normalizeSizes(sizes);
  const basePrice =
    normalizedSizes[0]?.price ?? (regularPrice === undefined ? price : regularPrice);
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const [result] = await connection.query(
      `INSERT INTO menu_items
        (category_id, name, price, image_path, is_available)
       VALUES (?, ?, ?, ?, ?)`,
      [
        categoryId,
        name,
        basePrice,
        imagePath || null,
        isAvailable ? 1 : 0,
      ]
    );

    await replaceOptions(connection, result.insertId, {
      sizes: normalizedSizes,
      variants,
    });

    await connection.commit();
    return findById(result.insertId);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const update = async (
  id,
  {
    categoryId,
    name,
    price,
    regularPrice,
    largePrice,
    variants = [],
    sizes = [],
    imagePath,
    isAvailable,
  }
) => {
  const normalizedSizes = normalizeSizes(sizes);
  const basePrice =
    normalizedSizes[0]?.price ?? (regularPrice === undefined ? price : regularPrice);
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    await connection.query(
      `UPDATE menu_items
       SET category_id = ?,
           name = ?,
           price = ?,
           image_path = ?,
           is_available = ?
       WHERE id = ?`,
      [
        categoryId,
        name,
        basePrice,
        imagePath || null,
        isAvailable ? 1 : 0,
        id,
      ]
    );

    await replaceOptions(connection, id, {
      sizes: normalizedSizes,
      variants,
    });

    await connection.commit();
    return findById(id);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
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
