const { pool } = require("../pool");
const {
  normalizeSizes,
  normalizeVariants,
} = require("../../../modules/menu/menu.options");
const { seedMenuIngredients } = require("./seedData");

const parseJsonArray = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value;

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
};


const replaceMenuItemOptions = async (menuItemId, { sizes, variants }) => {
  const normalizedSizes = normalizeSizes(sizes);
  const normalizedVariants = normalizeVariants(variants);

  await pool.query("DELETE FROM menu_item_sizes WHERE menu_item_id = ?", [
    menuItemId,
  ]);
  await pool.query("DELETE FROM menu_item_variants WHERE menu_item_id = ?", [
    menuItemId,
  ]);

  if (normalizedSizes.length) {
    await pool.query(
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
    await pool.query(
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

const migrateLegacyMenuOptions = async () => {
  const [columns] = await pool.query("SHOW COLUMNS FROM menu_items");
  const columnNames = new Set(columns.map((column) => column.Field));
  const hasRegularPrice = columnNames.has("regular_price");
  const hasPrice = columnNames.has("price");
  const hasLargePrice = columnNames.has("large_price");
  const hasVariantsJson = columnNames.has("variants_json");
  const hasSizesJson = columnNames.has("sizes_json");
  const regularPriceColumn = hasRegularPrice
    ? "regular_price"
    : hasPrice
      ? "price"
      : "NULL AS regular_price";

  const [items] = await pool.query(`
    SELECT id,
           ${regularPriceColumn}
           ${hasLargePrice ? ", large_price" : ""}
           ${hasVariantsJson ? ", variants_json" : ""}
           ${hasSizesJson ? ", sizes_json" : ""}
    FROM menu_items
  `);

  for (const item of items) {
    const [[sizeCountRow]] = await pool.query(
      "SELECT COUNT(*) AS total FROM menu_item_sizes WHERE menu_item_id = ?",
      [item.id]
    );
    const [[variantCountRow]] = await pool.query(
      "SELECT COUNT(*) AS total FROM menu_item_variants WHERE menu_item_id = ?",
      [item.id]
    );

    const sizesFromJson = hasSizesJson ? parseJsonArray(item.sizes_json) : [];
    const variantsFromJson = hasVariantsJson
      ? parseJsonArray(item.variants_json)
      : [];
    const regularPrice = Number(item.regular_price ?? item.price) || 0;
    const largePrice = Number(item.large_price) || 0;
    const fallbackSizes = largePrice
      ? [
          { name: "Reguler", price: regularPrice },
          { name: "Large", price: largePrice },
        ]
      : [];

    if (!sizeCountRow.total) {
      const nextSizes = sizesFromJson.length
        ? sizesFromJson
        : fallbackSizes;
      await replaceMenuItemOptions(item.id, {
        sizes: nextSizes,
        variants: variantCountRow.total ? [] : variantsFromJson,
      });
    } else if (!variantCountRow.total && variantsFromJson.length) {
      const normalizedVariants = normalizeVariants(variantsFromJson);
      await pool.query(
        `INSERT INTO menu_item_variants (menu_item_id, name, sort_order)
         VALUES ?`,
        [
          normalizedVariants.map((variant, index) => [
            item.id,
            variant,
            index + 1,
          ]),
        ]
      );
    }
  }
};


const seedDefaultMenuIngredients = async () => {
  const menuNames = Object.keys(seedMenuIngredients);
  if (!menuNames.length) return;

  const stockNames = [
    ...new Set(
      Object.values(seedMenuIngredients)
        .flat()
        .map(([stockName]) => stockName)
    ),
  ];

  const [menuRows] = await pool.query(
    `SELECT id, name FROM menu_items
     WHERE name IN (${menuNames.map(() => "?").join(", ")})`,
    menuNames
  );
  const [stockRows] = await pool.query(
    `SELECT id, name FROM stock_items
     WHERE name IN (${stockNames.map(() => "?").join(", ")})`,
    stockNames
  );

  const menuIdByName = new Map(menuRows.map((menu) => [menu.name, menu.id]));
  const stockIdByName = new Map(stockRows.map((stock) => [stock.name, stock.id]));

  for (const [menuName, ingredients] of Object.entries(seedMenuIngredients)) {
    const menuItemId = menuIdByName.get(menuName);
    if (!menuItemId) continue;

    const [[ingredientCount]] = await pool.query(
      "SELECT COUNT(*) AS total FROM menu_item_ingredients WHERE menu_item_id = ?",
      [menuItemId]
    );
    if (Number(ingredientCount.total) > 0) continue;

    await pool.query(
      `INSERT INTO menu_item_ingredients
        (menu_item_id, stock_item_id, size_name, ingredient_name, quantity, unit,
         sort_order, note)
       VALUES ?`,
      [
        ingredients.map(
          ([stockName, sizeName, quantity, unit, note], index) => [
            menuItemId,
            stockIdByName.get(stockName) || null,
            sizeName || null,
            stockName,
            quantity,
            unit,
            index + 1,
            note || null,
          ]
        ),
      ]
    );
  }
};

const removeSinglePriceSizeSpecificIngredients = async () => {
  await pool.query(`
    DELETE mii
    FROM menu_item_ingredients mii
    JOIN menu_items mi ON mi.id = mii.menu_item_id
    JOIN categories c ON c.id = mi.category_id
    WHERE c.name IN ('Coffee', 'Non-Coffee')
      AND mii.size_name IS NOT NULL
      AND TRIM(mii.size_name) <> ''
  `);
};

module.exports = {
  migrateLegacyMenuOptions,
  removeSinglePriceSizeSpecificIngredients,
  replaceMenuItemOptions,
  seedDefaultMenuIngredients,
};
