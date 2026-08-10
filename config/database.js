const mysql = require("mysql2/promise");
const config = require("./config");

const pool = mysql.createPool({
  host: config.dbHost,
  port: config.dbPort,
  user: config.dbUser,
  password: config.dbPassword,
  database: config.dbName,
  timezone: config.dbTimeZone,
  dateStrings: true,
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: true,
});

const serverPool = mysql.createPool({
  host: config.dbHost,
  port: config.dbPort,
  user: config.dbUser,
  password: config.dbPassword,
  timezone: config.dbTimeZone,
  dateStrings: true,
  waitForConnections: true,
  connectionLimit: 2,
});

const applyConnectionTimeZone = (connection) => {
  connection.query(`SET time_zone = '${config.dbTimeZone}'`);
};

pool.on("connection", applyConnectionTimeZone);
serverPool.on("connection", applyConnectionTimeZone);

const runSafeMigration = async (query) => {
  try {
    await pool.query(query);
  } catch (error) {
    // Keeps startup idempotent across fresh and already-migrated databases.
  }
};

const menuImage = (fileName) => `/uploads/menu/${fileName}`;

const seedCategories = [
  ["Coffee", "\u2615"],
  ["Non-Coffee", "\u{1F964}"],
  ["Main Course", "\u{1F35A}"],
  ["Snack", "\u{1F35F}"],
  ["Catering", "\u{1F371}"],
  ["Add Ons", "\u2795"],
];

const seedMenuItems = [
  ["Coffee", "Cappuccino", 18000, 21000, menuImage("cappuccino-d2eb185afd.jpg")],
  ["Coffee", "Cafe Latte", 18000, 21000, menuImage("cafe-latte-1acbe6600b.jpg")],
  ["Coffee", "Butterscotch Latte", 20000, 23000, menuImage("butterscotch-latte-3e444ae99e.jpg")],
  ["Coffee", "Caramel Latte", 20000, 23000, menuImage("caramel-latte-e6dd7de691.jpg")],
  ["Coffee", "Vanilla Latte", 20000, 23000, menuImage("vanilla-latte-8231e75eae.jpg")],
  ["Coffee", "Hazelnut Latte", 20000, 23000, menuImage("hazelnut-latte-6f30e26336.jpg")],
  ["Coffee", "Aren Latte", 20000, 23000, menuImage("aren-latte-9daa0860f4.jpg")],
  ["Coffee", "Moccacino", 22000, 25000, menuImage("moccacino-16b683cb90.jpg")],
  ["Coffee", "Berry Coffee Milk", 22000, 25000, menuImage("berry-coffee-milk-d7f69b0093.jpg")],
  ["Coffee", "Americano", 15000, 18000, menuImage("americano-a7098299e6.jpg")],
  ["Coffee", "Longblack", 15000, 18000, menuImage("longblack-c9fca6adf7.jpg")],
  ["Coffee", "On The Rock Espresso", 15000, 18000, menuImage("on-the-rock-espresso-1159307ad6.jpg")],
  ["Coffee", "Tropical Americano", 23000, 26000, menuImage("tropical-americano-911a87baf1.jpg")],
  ["Coffee", "Elberry Americano", 23000, 26000, menuImage("elberry-americano-c30281ce32.jpg")],
  ["Coffee", "Berry Summer", 23000, 26000, menuImage("berry-summer-27a7222ae3.jpg")],
  ["Non-Coffee", "Chocolate", 18000, 21000, menuImage("chocolate-317bab573b.jpg")],
  ["Non-Coffee", "Matcha", 18000, 21000, menuImage("matcha-05d3506b73.jpg")],
  ["Non-Coffee", "Cookies and Cream", 18000, 21000, menuImage("cookies-and-cream-4ba3428963.jpg")],
  ["Non-Coffee", "Lychee Tea", 13000, 16000, menuImage("lychee-tea-b961e917f7.jpg")],
  ["Non-Coffee", "Lemon Tea", 13000, 16000, menuImage("lemon-tea-6a2e7161fe.jpg")],
  ["Non-Coffee", "Jeruk Nipis Songkit", 13000, 16000, menuImage("jeruk-nipis-songkit-dd4a1bded6.jpg")],
  ["Non-Coffee", "Thai Tea", 15000, 18000, menuImage("thai-tea-6793cc6d8d.jpg")],
  ["Main Course", "Fried Egg Rice Bowl", 15000, menuImage("fried-egg-rice-bowl-71e4a6b35b.jpg")],
  ["Main Course", "Chicken Katsu Rice Bowl", 25000, menuImage("chicken-katsu-rice-bowl-9f77c07d83.jpg")],
  ["Main Course", "Chicken Teriyaki Rice Bowl", 23000, menuImage("chicken-teriyaki-rice-bowl-de9b95075d.jpg")],
  ["Main Course", "Ayam Geprek Rice Bowl", 22000, menuImage("ayam-geprek-rice-bowl-1ad15279c3.jpg")],
  ["Main Course", "Beef Teriyaki Rice Bowl", 25000, menuImage("beef-teriyaki-rice-bowl-bd0d2dccf0.jpg")],
  ["Main Course", "Indomie Goreng Telur", 15000, menuImage("indomie-goreng-telur-908692a040.jpg")],
  ["Main Course", "Indomie Rebus Telur", 15000, menuImage("indomie-rebus-telur-5bb08c107c.jpg")],
  ["Snack", "Kentang Goreng", 12000, menuImage("kentang-goreng-1bbb3108c0.jpg")],
  ["Snack", "Mix Platter", 22000, menuImage("mix-platter-f9eb1d5ba5.jpg")],
  ["Snack", "Cireng", 12000, menuImage("cireng-45396e6a79.jpg")],
  ["Snack", "Pisang Nugget Keju Coklat", 18000, menuImage("pisang-nugget-keju-coklat-e321243831.jpg")],
  ["Snack", "Roti Bakar", 15000, menuImage("roti-bakar-149c6fcfa6.jpg")],
  ["Catering", "Paket 20K / Box", 20000, menuImage("catering-paket-20k-e91f9d8973.jpg")],
  ["Catering", "Paket 28K / Box", 28000, menuImage("catering-paket-28k-296bcf3058.jpg")],
  ["Catering", "Paket 30K / Box", 30000, menuImage("catering-paket-30k-a602b24c5e.jpg")],
  ["Catering", "Paket 35K / Box", 35000, menuImage("catering-paket-35k-5bac09525e.jpg")],
  ["Catering", "Paket 40K / Box", 40000, menuImage("catering-paket-40k-daa33e5477.jpg")],
];

const seedAddOns = [
  ["nasi-putih", "Nasi Putih", 4000, menuImage("addon-nasi-putih-02e8184074.jpg")],
  ["telur", "Telur", 5000, menuImage("addon-telur-25fe043ebb.jpg")],
  ["buah", "Buah", 5000, menuImage("addon-buah-9c87ebb944.jpg")],
  ["sambal", "Sambal", 4000, menuImage("addon-sambal-17d98fec6b.jpg")],
  ["kerupuk", "Kerupuk", 3000, menuImage("addon-kerupuk-faaf6f2c8f.jpg")],
  ["air-mineral", "Air Mineral", 5000, menuImage("addon-air-mineral-4dab72aab0.jpg")],
];

const seedMenuCatalog = [
  ...seedMenuItems,
  ...seedAddOns.map(([, name, price, imagePath]) => [
    "Add Ons",
    name,
    price,
    imagePath,
  ]),
];

const singlePriceCategories = new Set(["Coffee", "Non-Coffee"]);
const noTemperatureVariantMenuItems = new Set([
  "On The Rock Espresso",
  "Tropical Americano",
  "Elberry Americano",
  "Berry Summer",
  "Cookies and Cream",
]);

const shouldUseSinglePrice = (categoryName) =>
  singlePriceCategories.has(categoryName);

const getSeedTemperatureVariants = (categoryName, menuName) =>
  singlePriceCategories.has(categoryName) &&
  !noTemperatureVariantMenuItems.has(menuName)
    ? ["Cold", "Hot"]
    : [];

const seedStockItems = [
  ["ESPRESSO", "Coffee", "gr", 999, 0, "", false],
  ["WATER", "Beverage", "ml", 999, 0, "", true],
  ["CUP", "Packaging", "pcs", 999, 0, "", false],
  ["SYRUP BUTTERSCOTH", "Syrup", "ml", 999, 0, "", false],
  ["CREAMER", "Dairy", "gr", 999, 0, "", false],
  ["FRESHMILK", "Dairy", "ml", 999, 0, "", false],
  ["SYRUP CLASSC CARAMEL", "Syrup", "ml", 999, 0, "", false],
  ["SYRUP VANILLA TRADITIO", "Syrup", "ml", 999, 0, "", false],
  ["SYRUP HAZELNUT", "Syrup", "ml", 999, 0, "", false],
  ["SYRUP AREN", "Syrup", "ml", 999, 0, "", false],
  ["POWDER CHOCOLATE", "Powder", "gr", 999, 0, "", false],
  ["POWDER MATCHA", "Powder", "gr", 999, 0, "", false],
  ["SYRUP STRAWBERRY", "Syrup", "ml", 999, 0, "", false],
  ["SYRUP LYCHEE", "Syrup", "ml", 999, 0, "", false],
  ["SYRUP PINEAPPLE", "Syrup", "ml", 999, 0, "", false],
  ["SYRUP LEMON", "Syrup", "ml", 999, 0, "", false],
  ["SYRUP VANILLA", "Syrup", "ml", 999, 0, "", false],
  ["POWDER COOKIES AND CREAM", "Powder", "gr", 999, 0, "", false],
  ["POWDER LYCHEE TEA", "Powder", "gr", 999, 0, "", false],
  ["POWDER LEMON TEA", "Powder", "gr", 999, 0, "", false],
  ["POWDER SONGKIT", "Powder", "gr", 999, 0, "", false],
  ["POWDER THAI TEA", "Powder", "gr", 999, 0, "", false],
  ["SKM", "Dairy", "ml", 999, 0, "", false],
];

const seedMenuIngredients = {
  Americano: [
    ["ESPRESSO", "", 8, "gr"],
    ["WATER", "", 100, "ml"],
    ["CUP", "", 1, "pcs"],
  ],
  "Aren Latte": [
    ["ESPRESSO", "", 8, "gr"],
    ["SYRUP AREN", "", 15, "ml"],
    ["CREAMER", "", 15, "gr"],
    ["FRESHMILK", "", 100, "ml"],
    ["CUP", "", 1, "pcs"],
    ["FRESHMILK", "Large", 20, "ml", "Tambahan ukuran Large"],
  ],
  "Berry Coffee Milk": [
    ["ESPRESSO", "", 8, "gr"],
    ["SYRUP STRAWBERRY", "", 10, "ml"],
    ["SYRUP LYCHEE", "", 5, "ml"],
    ["SYRUP BUTTERSCOTH", "", 5, "ml"],
    ["FRESHMILK", "", 80, "ml"],
    ["CUP", "", 1, "pcs"],
    ["FRESHMILK", "Large", 20, "ml", "Tambahan ukuran Large"],
  ],
  "Berry Summer": [
    ["ESPRESSO", "", 8, "gr"],
    ["SYRUP STRAWBERRY", "", 10, "ml"],
    ["SYRUP VANILLA", "", 5, "ml"],
    ["SYRUP PINEAPPLE", "", 5, "ml"],
    ["WATER", "", 80, "ml"],
    ["CUP", "", 1, "pcs"],
  ],
  "Butterscotch Latte": [
    ["ESPRESSO", "", 8, "gr"],
    ["SYRUP BUTTERSCOTH", "", 15, "ml"],
    ["CREAMER", "", 15, "gr"],
    ["FRESHMILK", "", 100, "ml"],
    ["CUP", "", 1, "pcs"],
    ["FRESHMILK", "Large", 20, "ml", "Tambahan ukuran Large"],
  ],
  "Cafe Latte": [
    ["ESPRESSO", "", 8, "gr"],
    ["FRESHMILK", "", 100, "ml"],
    ["CUP", "", 1, "pcs"],
    ["FRESHMILK", "Large", 20, "ml", "Tambahan ukuran Large"],
  ],
  Cappuccino: [
    ["ESPRESSO", "", 8, "gr"],
    ["FRESHMILK", "", 100, "ml"],
    ["CUP", "", 1, "pcs"],
    ["FRESHMILK", "Large", 20, "ml", "Tambahan ukuran Large"],
  ],
  "Caramel Latte": [
    ["ESPRESSO", "", 8, "gr"],
    ["SYRUP CLASSC CARAMEL", "", 15, "ml"],
    ["CREAMER", "", 15, "gr"],
    ["FRESHMILK", "", 100, "ml"],
    ["CUP", "", 1, "pcs"],
    ["FRESHMILK", "Large", 20, "ml", "Tambahan ukuran Large"],
  ],
  Chocolate: [
    ["POWDER CHOCOLATE", "", 15, "gr"],
    ["FRESHMILK", "", 100, "ml"],
    ["CUP", "", 1, "pcs"],
    ["FRESHMILK", "Large", 20, "ml", "Tambahan ukuran Large"],
  ],
  "Cookies and Cream": [
    ["POWDER COOKIES AND CREAM", "", 15, "gr"],
    ["FRESHMILK", "", 100, "ml"],
    ["CUP", "", 1, "pcs"],
    ["FRESHMILK", "Large", 20, "ml", "Tambahan ukuran Large"],
  ],
  "Elberry Americano": [
    ["ESPRESSO", "", 8, "gr"],
    ["SYRUP STRAWBERRY", "", 10, "ml"],
    ["SYRUP LYCHEE", "", 5, "ml"],
    ["SYRUP LEMON", "", 5, "ml"],
    ["WATER", "", 80, "ml"],
    ["CUP", "", 1, "pcs"],
  ],
  "Hazelnut Latte": [
    ["ESPRESSO", "", 8, "gr"],
    ["SYRUP HAZELNUT", "", 15, "ml"],
    ["CREAMER", "", 15, "gr"],
    ["FRESHMILK", "", 100, "ml"],
    ["CUP", "", 1, "pcs"],
    ["FRESHMILK", "Large", 20, "ml", "Tambahan ukuran Large"],
  ],
  "Jeruk Nipis Songkit": [
    ["POWDER SONGKIT", "", 15, "gr"],
    ["WATER", "", 100, "ml"],
    ["CUP", "", 1, "pcs"],
  ],
  "Lemon Tea": [
    ["POWDER LEMON TEA", "", 15, "gr"],
    ["WATER", "", 100, "ml"],
    ["CUP", "", 1, "pcs"],
  ],
  Longblack: [
    ["ESPRESSO", "", 15, "gr"],
    ["WATER", "", 100, "ml"],
    ["CUP", "", 1, "pcs"],
  ],
  "Lychee Tea": [
    ["POWDER LYCHEE TEA", "", 15, "gr"],
    ["WATER", "", 100, "ml"],
    ["CUP", "", 1, "pcs"],
  ],
  Matcha: [
    ["POWDER MATCHA", "", 15, "gr"],
    ["FRESHMILK", "", 100, "ml"],
    ["CUP", "", 1, "pcs"],
    ["FRESHMILK", "Large", 20, "ml", "Tambahan ukuran Large"],
  ],
  Moccacino: [
    ["ESPRESSO", "", 8, "gr"],
    ["POWDER CHOCOLATE", "", 10, "gr"],
    ["FRESHMILK", "", 100, "ml"],
    ["CUP", "", 1, "pcs"],
    ["FRESHMILK", "Large", 20, "ml", "Tambahan ukuran Large"],
  ],
  "On The Rock Espresso": [
    ["ESPRESSO", "", 15, "gr"],
    ["CUP", "", 1, "pcs"],
  ],
  "Thai Tea": [
    ["POWDER THAI TEA", "", 15, "gr"],
    ["SKM", "", 5, "ml"],
    ["FRESHMILK", "", 100, "ml"],
    ["CUP", "", 1, "pcs"],
    ["FRESHMILK", "Large", 20, "ml", "Tambahan ukuran Large"],
  ],
  "Tropical Americano": [
    ["ESPRESSO", "", 8, "gr"],
    ["SYRUP PINEAPPLE", "", 10, "ml"],
    ["SYRUP LYCHEE", "", 5, "ml"],
    ["SYRUP LEMON", "", 5, "ml"],
    ["WATER", "", 80, "ml"],
    ["CUP", "", 1, "pcs"],
  ],
  "Vanilla Latte": [
    ["ESPRESSO", "", 8, "gr"],
    ["SYRUP VANILLA TRADITIO", "", 15, "ml"],
    ["CREAMER", "", 15, "gr"],
    ["FRESHMILK", "", 100, "ml"],
    ["CUP", "", 1, "pcs"],
    ["FRESHMILK", "Large", 20, "ml", "Tambahan ukuran Large"],
  ],
};

const seedMenuFinancials = {
  Americano: { hppCost: 3009.5, grossProfit: 11990.5 },
  Longblack: { hppCost: 4875, grossProfit: 10125 },
  "On The Rock Espresso": { hppCost: 4745, grossProfit: 10255 },
  "Butterscotch Latte": {
    hppCost: 9134.029411764706,
    grossProfit: 10865.970588235294,
  },
  "Caramel Latte": {
    hppCost: 9134.029411764706,
    grossProfit: 10865.970588235294,
  },
  "Vanilla Latte": {
    hppCost: 9134.029411764706,
    grossProfit: 10865.970588235294,
  },
  "Hazelnut Latte": {
    hppCost: 9134.029411764706,
    grossProfit: 10865.970588235294,
  },
  "Aren Latte": { hppCost: 7720.500000000001, grossProfit: 12279.5 },
  "Cafe Latte": { hppCost: 5440.5, grossProfit: 12559.5 },
  Cappuccino: { hppCost: 5440.5, grossProfit: 12559.5 },
  Moccacino: { hppCost: 8121.75, grossProfit: 13878.25 },
  "Berry Coffee Milk": {
    hppCost: 8293.005882352942,
    grossProfit: 13706.994117647058,
  },
  "Tropical Americano": {
    hppCost: 6348.205882352941,
    grossProfit: 16651.79411764706,
  },
  "Elberry Americano": {
    hppCost: 6348.205882352941,
    grossProfit: 16651.79411764706,
  },
  "Berry Summer": {
    hppCost: 6348.205882352941,
    grossProfit: 16651.79411764706,
  },
  Chocolate: { hppCost: 7330.375, grossProfit: 10669.625 },
  Matcha: { hppCost: 7427.875, grossProfit: 10572.125 },
  "Cookies and Cream": { hppCost: 7135.375, grossProfit: 10864.625 },
  "Lychee Tea": { hppCost: 2320.5, grossProfit: 10679.5 },
  "Lemon Tea": { hppCost: 2184, grossProfit: 10816 },
  "Jeruk Nipis Songkit": { hppCost: 3081, grossProfit: 9919 },
  "Thai Tea": {
    hppCost: 5227.368421052632,
    grossProfit: 9772.631578947368,
  },
};

const seedIngredientHppUnitCosts = {
  FRESHMILK: 25.61,
};

const roundCurrency = (value) => Math.round((Number(value) || 0) * 100) / 100;

const getLargeHppAdjustment = (menuName) =>
  (seedMenuIngredients[menuName] || [])
    .filter(([, sizeName]) => String(sizeName || "").toLowerCase() === "large")
    .reduce((total, [stockName, , quantity]) => {
      const unitCost = seedIngredientHppUnitCosts[stockName] || 0;
      return total + Number(quantity || 0) * unitCost;
    }, 0);

const getSeedSizeFinancials = (menuName, sizeName, price) => {
  const financials = seedMenuFinancials[menuName];
  if (!financials) {
    return { hppCost: 0, grossProfit: 0 };
  }

  if (String(sizeName).toLowerCase() !== "large") {
    return {
      hppCost: roundCurrency(financials.hppCost),
      grossProfit: roundCurrency(financials.grossProfit),
    };
  }

  const hppCost = roundCurrency(
    financials.hppCost + getLargeHppAdjustment(menuName)
  );

  return {
    hppCost,
    grossProfit: roundCurrency(Number(price || 0) - hppCost),
  };
};

const seedOrderPlatforms = [
  ["GoFood", "/platforms/gofood.png"],
  ["GrabFood", "/platforms/grabfood.png"],
  ["ShopeeFood", "/platforms/shopeefood.png"],
];

const seedRecapFormats = [
  ["daily", "Harian", "Rekap operasional harian", true, 1],
  ["weekly", "Mingguan", "Rekap operasional mingguan", true, 2],
  ["monthly", "Bulanan", "Rekap operasional bulanan", true, 3],
];

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

const normalizeSizes = (sizes) =>
  (Array.isArray(sizes) ? sizes : [])
    .map((size) => ({
      name: String(size?.name || "").trim(),
      price: Number(size?.price) || 0,
      hppCost: Number(size?.hppCost ?? size?.hpp_cost) || 0,
      grossProfit: Number(size?.grossProfit ?? size?.gross_profit) || 0,
    }))
    .filter((size) => size.name && size.price >= 0);

const normalizeVariants = (variants) =>
  (Array.isArray(variants) ? variants : [])
    .map((variant) => String(variant || "").trim())
    .filter(Boolean);

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
  const hasLargePrice = columnNames.has("large_price");
  const hasVariantsJson = columnNames.has("variants_json");
  const hasSizesJson = columnNames.has("sizes_json");

  const [items] = await pool.query(`
    SELECT id,
           price
           ${hasRegularPrice ? ", regular_price" : ""}
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

const deactivateRowsOutsideList = async (table, column, activeColumn, values) => {
  if (!values.length) return;

  const placeholders = values.map(() => "?").join(", ");
  await pool.query(
    `UPDATE ${table} SET ${activeColumn} = FALSE WHERE ${column} NOT IN (${placeholders})`,
    values
  );
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

const connectDB = async () => {
  await serverPool.query(
    `CREATE DATABASE IF NOT EXISTS \`${config.dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      phone VARCHAR(30) NOT NULL,
      email VARCHAR(150) NOT NULL UNIQUE,
      password VARCHAR(255) NOT NULL,
      role VARCHAR(50) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
  await runSafeMigration("UPDATE users SET role = 'Cashier' WHERE LOWER(role) = 'waiter'");
  await runSafeMigration("UPDATE users SET name = 'Cashier' WHERE LOWER(name) = 'waiter'");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS categories (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL UNIQUE,
      icon VARCHAR(20),
      tax DECIMAL(5,2) NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_categories_sort_order (sort_order, name)
    )
  `);
  await runSafeMigration("ALTER TABLE categories DROP COLUMN bg_color");
  await runSafeMigration("ALTER TABLE categories ADD COLUMN tax DECIMAL(5,2) NULL AFTER icon");
  await runSafeMigration("ALTER TABLE categories ADD COLUMN sort_order INT NOT NULL DEFAULT 0 AFTER is_active");
  await runSafeMigration("CREATE INDEX idx_categories_sort_order ON categories (sort_order, name)");
  await runSafeMigration(`
    UPDATE categories
    SET sort_order = CASE name
      WHEN 'Coffee' THEN 10
      WHEN 'Non-Coffee' THEN 20
      WHEN 'Main Course' THEN 30
      WHEN 'Snack' THEN 40
      WHEN 'Add Ons' THEN 50
      WHEN 'Catering' THEN 60
      ELSE 1000 + id
    END
    WHERE sort_order = 0
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS menu_items (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      category_id INT UNSIGNED NOT NULL,
      name VARCHAR(150) NOT NULL,
      price DECIMAL(12,2) NULL,
      hpp_cost DECIMAL(12,2) NULL,
      gross_profit DECIMAL(12,2) NULL,
      image_path VARCHAR(255),
      is_available BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_menu_items_category_id (category_id),
      CONSTRAINT fk_menu_items_category
        FOREIGN KEY (category_id) REFERENCES categories(id)
        ON DELETE CASCADE
    )
  `);
  await runSafeMigration("ALTER TABLE menu_items DROP COLUMN description");
  await runSafeMigration("ALTER TABLE menu_items CHANGE COLUMN image_url image_path VARCHAR(255) NULL");
  await runSafeMigration("UPDATE menu_items SET image_path = NULL WHERE image_path IS NOT NULL AND image_path NOT LIKE '/uploads/%'");
  await runSafeMigration("ALTER TABLE menu_items ADD COLUMN hpp_cost DECIMAL(12,2) NULL AFTER price");
  await runSafeMigration("ALTER TABLE menu_items ADD COLUMN gross_profit DECIMAL(12,2) NULL AFTER hpp_cost");
  await runSafeMigration("ALTER TABLE menu_items DROP COLUMN gross_profit_margin");
  await runSafeMigration("ALTER TABLE menu_items MODIFY COLUMN price DECIMAL(12,2) NULL");
  await runSafeMigration("ALTER TABLE menu_items MODIFY COLUMN hpp_cost DECIMAL(12,2) NULL");
  await runSafeMigration("ALTER TABLE menu_items MODIFY COLUMN gross_profit DECIMAL(12,2) NULL");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS menu_item_sizes (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      menu_item_id INT UNSIGNED NOT NULL,
      name VARCHAR(80) NOT NULL,
      price DECIMAL(12,2) NOT NULL,
      hpp_cost DECIMAL(12,2) NOT NULL DEFAULT 0,
      gross_profit DECIMAL(12,2) NOT NULL DEFAULT 0,
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_menu_item_sizes_menu_item_id (menu_item_id),
      UNIQUE KEY uniq_menu_item_sizes_name (menu_item_id, name),
      CONSTRAINT fk_menu_item_sizes_menu_item
        FOREIGN KEY (menu_item_id) REFERENCES menu_items(id)
        ON DELETE CASCADE
    )
  `);
  await runSafeMigration("ALTER TABLE menu_item_sizes ADD COLUMN hpp_cost DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER price");
  await runSafeMigration("ALTER TABLE menu_item_sizes ADD COLUMN gross_profit DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER hpp_cost");
  await runSafeMigration(`
    UPDATE menu_items mi
    SET mi.price = NULL,
        mi.hpp_cost = NULL,
        mi.gross_profit = NULL
    WHERE EXISTS (
      SELECT 1
      FROM menu_item_sizes mis
      WHERE mis.menu_item_id = mi.id
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS menu_item_variants (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      menu_item_id INT UNSIGNED NOT NULL,
      name VARCHAR(80) NOT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_menu_item_variants_menu_item_id (menu_item_id),
      UNIQUE KEY uniq_menu_item_variants_name (menu_item_id, name),
      CONSTRAINT fk_menu_item_variants_menu_item
        FOREIGN KEY (menu_item_id) REFERENCES menu_items(id)
        ON DELETE CASCADE
    )
  `);

  await migrateLegacyMenuOptions();
  await runSafeMigration("ALTER TABLE menu_items DROP COLUMN regular_price");
  await runSafeMigration("ALTER TABLE menu_items DROP COLUMN large_price");
  await runSafeMigration("ALTER TABLE menu_items DROP COLUMN variants_json");
  await runSafeMigration("ALTER TABLE menu_items DROP COLUMN sizes_json");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS order_platforms (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL UNIQUE,
      icon_url VARCHAR(255),
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
  await runSafeMigration("ALTER TABLE order_platforms ADD COLUMN icon_url VARCHAR(255) NULL AFTER name");

  await pool.query(
    `INSERT INTO order_platforms (name, icon_url)
     VALUES ?
     ON DUPLICATE KEY UPDATE
       icon_url = VALUES(icon_url)`,
    [seedOrderPlatforms]
  );
  await runSafeMigration("DELETE FROM order_platforms WHERE name = 'Maxim Food'");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS stock_items (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(150) NOT NULL UNIQUE,
      category VARCHAR(100) NOT NULL,
      unit VARCHAR(30) NOT NULL,
      stock DECIMAL(12,2) NOT NULL DEFAULT 0,
      minimum_stock DECIMAL(12,2) NOT NULL DEFAULT 0,
      supplier VARCHAR(150),
      is_unlimited BOOLEAN NOT NULL DEFAULT FALSE,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_stock_items_category (category),
      INDEX idx_stock_items_is_active (is_active)
    )
  `);
  await runSafeMigration("ALTER TABLE stock_items ADD COLUMN is_unlimited BOOLEAN NOT NULL DEFAULT FALSE AFTER supplier");

  await pool.query(
    `INSERT INTO stock_items
      (name, category, unit, stock, minimum_stock, supplier, is_unlimited)
     VALUES ?
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       category = VALUES(category),
       unit = VALUES(unit),
       minimum_stock = VALUES(minimum_stock),
       supplier = VALUES(supplier),
       is_unlimited = VALUES(is_unlimited),
       is_active = TRUE`,
    [seedStockItems]
  );
  await deactivateRowsOutsideList(
    "stock_items",
    "name",
    "is_active",
    seedStockItems.map(([name]) => name)
  );

  await pool.query(`
    CREATE TABLE IF NOT EXISTS menu_item_ingredients (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      menu_item_id INT UNSIGNED NOT NULL,
      stock_item_id INT UNSIGNED NULL,
      size_name VARCHAR(80) NULL,
      ingredient_name VARCHAR(150) NOT NULL,
      quantity DECIMAL(12,3) NOT NULL DEFAULT 0,
      unit VARCHAR(30) NOT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      note VARCHAR(255) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_menu_item_ingredients_menu_item_id (menu_item_id),
      INDEX idx_menu_item_ingredients_stock_item_id (stock_item_id),
      CONSTRAINT fk_menu_item_ingredients_menu_item
        FOREIGN KEY (menu_item_id) REFERENCES menu_items(id)
        ON DELETE CASCADE,
      CONSTRAINT fk_menu_item_ingredients_stock_item
        FOREIGN KEY (stock_item_id) REFERENCES stock_items(id)
        ON DELETE SET NULL
    )
  `);
  await runSafeMigration("ALTER TABLE menu_item_ingredients ADD COLUMN size_name VARCHAR(80) NULL AFTER stock_item_id");
  await runSafeMigration("ALTER TABLE menu_item_ingredients DROP COLUMN unit_cost");

  const defaultCategories = [
    ["Starters", "🍲"],
    ["Main Course", "🍛"],
    ["Beverages", "🍹"],
    ["Soups", "🍜"],
    ["Desserts", "🍰"],
    ["Pizzas", "🍕"],
    ["Alcoholic Drinks", "🍺"],
    ["Salads", "🥗"],
  ];

  await pool.query(
    `INSERT INTO categories (name, icon)
     VALUES ?
     ON DUPLICATE KEY UPDATE
       icon = COALESCE(NULLIF(icon, ''), VALUES(icon))`,
    [seedCategories]
  );
  await runSafeMigration(`
    UPDATE categories
    SET sort_order = CASE name
      WHEN 'Coffee' THEN 10
      WHEN 'Non-Coffee' THEN 20
      WHEN 'Main Course' THEN 30
      WHEN 'Snack' THEN 40
      WHEN 'Add Ons' THEN 50
      WHEN 'Catering' THEN 60
      ELSE 1000 + id
    END
    WHERE sort_order = 0
  `);

  const [categoryRows] = await pool.query(
    `SELECT id, name FROM categories
     WHERE name IN (${seedCategories.map(() => "?").join(", ")})`,
    seedCategories.map(([name]) => name)
  );
  const categoryIdByName = new Map(
    categoryRows.map((category) => [category.name, category.id])
  );

  for (const seedMenuItem of seedMenuCatalog) {
    const [categoryName, name, regularPrice, largePriceOrImageUrl, maybeImageUrl] =
      seedMenuItem;
    const seedHasLargePrice = typeof largePriceOrImageUrl === "number";
    const usesSinglePrice = shouldUseSinglePrice(categoryName);
    const hasLargePrice = seedHasLargePrice && !usesSinglePrice;
    const largePrice = hasLargePrice ? largePriceOrImageUrl : null;
    const imagePathCandidate = seedHasLargePrice
      ? maybeImageUrl
      : largePriceOrImageUrl;
    const seedImagePath =
      typeof imagePathCandidate === "string" &&
      imagePathCandidate.startsWith("/uploads/")
        ? imagePathCandidate
        : null;
    const variants = getSeedTemperatureVariants(categoryName, name);
    const sizes = hasLargePrice
      ? [
          {
            name: "Reguler",
            price: regularPrice,
            ...getSeedSizeFinancials(name, "Reguler", regularPrice),
          },
          {
            name: "Large",
            price: largePrice,
            ...getSeedSizeFinancials(name, "Large", largePrice),
          },
        ]
      : [];
    const categoryId = categoryIdByName.get(categoryName);
    const baseFinancials = seedMenuFinancials[name] || {
      hppCost: 0,
      grossProfit: 0,
    };
    if (!categoryId) continue;

    const [existingRows] = await pool.query(
      "SELECT id FROM menu_items WHERE name = ? LIMIT 1",
      [name]
    );

    let menuItemId;

    if (existingRows.length) {
      menuItemId = existingRows[0].id;
      await pool.query(
        `UPDATE menu_items
         SET category_id = ?,
             price = ?,
             hpp_cost = ?,
             gross_profit = ?,
             image_path = ?
          WHERE id = ?`,
        [
          categoryId,
          sizes.length ? null : regularPrice,
          sizes.length ? null : roundCurrency(baseFinancials.hppCost),
          sizes.length ? null : roundCurrency(baseFinancials.grossProfit),
          seedImagePath,
          menuItemId,
        ]
      );
    } else {
      const [result] = await pool.query(
        `INSERT INTO menu_items
          (category_id, name, price, hpp_cost, gross_profit, image_path, is_available)
         VALUES (?, ?, ?, ?, ?, ?, TRUE)`,
        [
          categoryId,
          name,
          sizes.length ? null : regularPrice,
          sizes.length ? null : roundCurrency(baseFinancials.hppCost),
          sizes.length ? null : roundCurrency(baseFinancials.grossProfit),
          seedImagePath,
        ]
      );
      menuItemId = result.insertId;
    }

    await replaceMenuItemOptions(menuItemId, { sizes, variants });
  }
  await runSafeMigration(`
    DELETE mis
    FROM menu_item_sizes mis
    JOIN menu_items mi ON mi.id = mis.menu_item_id
    JOIN (
      SELECT menu_item_id, COUNT(*) AS total
      FROM menu_item_sizes
      GROUP BY menu_item_id
    ) size_counts ON size_counts.menu_item_id = mis.menu_item_id
    WHERE size_counts.total = 1
      AND mis.name = 'Harga'
      AND mis.price = mi.price
  `);
  await seedDefaultMenuIngredients();
  await removeSinglePriceSizeSpecificIngredients();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      order_code VARCHAR(40) UNIQUE,
      customer_name VARCHAR(100) NOT NULL,
      guests INT NOT NULL,
      order_type VARCHAR(50) NOT NULL DEFAULT 'Offline',
      order_platform VARCHAR(100),
      order_status VARCHAR(50) NOT NULL,
      order_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      total DECIMAL(12,2) NOT NULL,
      online_order_charge DECIMAL(12,2) NOT NULL DEFAULT 0,
      tax DECIMAL(12,2) NOT NULL,
      total_with_tax DECIMAL(12,2) NOT NULL,
      payment_method VARCHAR(50),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  await runSafeMigration("ALTER TABLE orders ADD COLUMN order_code VARCHAR(40) UNIQUE AFTER id");
  await runSafeMigration("ALTER TABLE orders ADD COLUMN order_type VARCHAR(50) NOT NULL DEFAULT 'Offline' AFTER guests");
  await runSafeMigration("ALTER TABLE orders ADD COLUMN order_platform VARCHAR(100) NULL AFTER order_type");
  await runSafeMigration("ALTER TABLE orders ADD COLUMN online_order_charge DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER total");
  await runSafeMigration("UPDATE orders SET order_type = 'Offline' WHERE order_type = 'Dine In'");
  await runSafeMigration("UPDATE orders SET order_type = 'Online' WHERE order_type = 'Online Order'");
  await runSafeMigration("UPDATE orders SET order_code = CONCAT('ORD-', LPAD(id, 6, '0')) WHERE order_code IS NULL OR order_code = ''");
  await pool.query("UPDATE orders SET order_status = 'Completed' WHERE order_status = 'Ready'");
  await runSafeMigration("ALTER TABLE orders DROP FOREIGN KEY fk_orders_table");
  await runSafeMigration("DROP INDEX idx_orders_table_id ON orders");
  await runSafeMigration("ALTER TABLE orders DROP COLUMN table_id");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS order_online_transactions (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      order_id INT UNSIGNED NOT NULL UNIQUE,
      midtrans_order_id VARCHAR(100),
      midtrans_transaction_id VARCHAR(100),
      midtrans_payment_type VARCHAR(100),
      midtrans_transaction_status VARCHAR(100),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_order_online_transactions_order
        FOREIGN KEY (order_id) REFERENCES orders(id)
        ON DELETE CASCADE
    )
  `);

  await runSafeMigration(`
    INSERT INTO order_online_transactions
      (order_id, midtrans_order_id, midtrans_transaction_id,
       midtrans_payment_type, midtrans_transaction_status)
    SELECT
      id, midtrans_order_id, midtrans_transaction_id,
      midtrans_payment_type, midtrans_transaction_status
    FROM orders
    WHERE midtrans_order_id IS NOT NULL
       OR midtrans_transaction_id IS NOT NULL
       OR midtrans_payment_type IS NOT NULL
       OR midtrans_transaction_status IS NOT NULL
    ON DUPLICATE KEY UPDATE
      midtrans_order_id = VALUES(midtrans_order_id),
      midtrans_transaction_id = VALUES(midtrans_transaction_id),
      midtrans_payment_type = VALUES(midtrans_payment_type),
      midtrans_transaction_status = VALUES(midtrans_transaction_status)
  `);
  await runSafeMigration("ALTER TABLE orders DROP COLUMN customer_phone");
  await runSafeMigration("ALTER TABLE orders DROP COLUMN midtrans_order_id");
  await runSafeMigration("ALTER TABLE orders DROP COLUMN midtrans_transaction_id");
  await runSafeMigration("ALTER TABLE orders DROP COLUMN midtrans_payment_type");
  await runSafeMigration("ALTER TABLE orders DROP COLUMN midtrans_transaction_status");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS order_catering_details (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      order_id INT UNSIGNED NOT NULL UNIQUE,
      institution VARCHAR(150),
      whatsapp VARCHAR(50),
      order_date DATE,
      event_date DATE,
      delivery_time TIME,
      payment_plan VARCHAR(20) NOT NULL DEFAULT 'Full',
      dp_received DECIMAL(12,2) NOT NULL DEFAULT 0,
      is_paid BOOLEAN NOT NULL DEFAULT FALSE,
      note TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_order_catering_details_order
        FOREIGN KEY (order_id) REFERENCES orders(id)
        ON DELETE CASCADE
    )
  `);
  await runSafeMigration("ALTER TABLE order_catering_details ADD COLUMN payment_plan VARCHAR(20) NOT NULL DEFAULT 'Full' AFTER delivery_time");
  await runSafeMigration("ALTER TABLE order_catering_details ADD COLUMN is_paid BOOLEAN NOT NULL DEFAULT FALSE AFTER dp_received");
  await runSafeMigration("UPDATE order_catering_details SET is_paid = TRUE WHERE payment_plan = 'Full'");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS order_items (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      order_id INT UNSIGNED NOT NULL,
      item_key VARCHAR(100),
      menu_item_id INT UNSIGNED NULL,
      size_name VARCHAR(80) NULL,
      name VARCHAR(150) NOT NULL,
      variant VARCHAR(50) NULL,
      quantity INT NOT NULL,
      price_per_quantity DECIMAL(12,2) NOT NULL,
      hpp_cost DECIMAL(12,2) NOT NULL DEFAULT 0,
      price DECIMAL(12,2) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_order_items_order_id (order_id),
      INDEX idx_order_items_menu_item_id (menu_item_id),
      CONSTRAINT fk_order_items_order
        FOREIGN KEY (order_id) REFERENCES orders(id)
        ON DELETE CASCADE,
      CONSTRAINT fk_order_items_menu_item
        FOREIGN KEY (menu_item_id) REFERENCES menu_items(id)
        ON DELETE SET NULL
    )
  `);
  await runSafeMigration("ALTER TABLE order_items ADD COLUMN menu_item_id INT UNSIGNED NULL AFTER item_key");
  await runSafeMigration("ALTER TABLE order_items ADD COLUMN size_name VARCHAR(80) NULL AFTER menu_item_id");
  await runSafeMigration("ALTER TABLE order_items ADD COLUMN variant VARCHAR(50) NULL AFTER name");
  await runSafeMigration("ALTER TABLE order_items ADD COLUMN hpp_cost DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER price_per_quantity");
  await runSafeMigration("CREATE INDEX idx_order_items_menu_item_id ON order_items (menu_item_id)");
  await runSafeMigration(`
    UPDATE order_items oi
    JOIN menu_items mi
      ON mi.id = CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(oi.item_key, '-', 2), '-', -1) AS UNSIGNED)
    SET oi.menu_item_id = mi.id
    WHERE oi.menu_item_id IS NULL
      AND oi.item_key REGEXP '^[0-9]+-[0-9]+'
  `);
  await runSafeMigration(`
    UPDATE order_items oi
    SET oi.size_name = NULLIF(
      TRIM(SUBSTRING(oi.item_key, LENGTH(SUBSTRING_INDEX(oi.item_key, '-', 2)) + 2)),
      ''
    )
    WHERE oi.size_name IS NULL
      AND oi.item_key REGEXP '^[0-9]+-[0-9]+-.+'
  `);
  await runSafeMigration(`
    UPDATE order_items oi
    LEFT JOIN menu_items mi ON mi.id = oi.menu_item_id
    SET oi.hpp_cost = COALESCE(
      (
        SELECT mis.hpp_cost
        FROM menu_item_sizes mis
        WHERE mis.menu_item_id = oi.menu_item_id
          AND LOWER(mis.name) = LOWER(oi.size_name)
        LIMIT 1
      ),
      (
        SELECT mis.hpp_cost
        FROM menu_item_sizes mis
        WHERE mis.menu_item_id = oi.menu_item_id
        ORDER BY mis.sort_order ASC, mis.id ASC
        LIMIT 1
      ),
      mi.hpp_cost,
      0
    )
    WHERE oi.hpp_cost = 0
  `);
  await runSafeMigration(`
    ALTER TABLE order_items
    ADD CONSTRAINT fk_order_items_menu_item
      FOREIGN KEY (menu_item_id) REFERENCES menu_items(id)
      ON DELETE SET NULL
  `);

  await runSafeMigration("DROP TABLE IF EXISTS order_item_addons");
  await runSafeMigration("DROP TABLE IF EXISTS add_ons");

  await runSafeMigration("ALTER TABLE order_items DROP COLUMN addons");
  await runSafeMigration("ALTER TABLE order_items DROP COLUMN note");
  await runSafeMigration("DROP TABLE IF EXISTS restaurant_tables");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS payments (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      payment_id VARCHAR(150),
      order_id VARCHAR(150),
      amount DECIMAL(12,2),
      currency VARCHAR(20),
      status VARCHAR(50),
      method VARCHAR(100),
      email VARCHAR(150),
      contact VARCHAR(50),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS meta_data_format_recap (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      code VARCHAR(20) NOT NULL UNIQUE,
      label VARCHAR(150) NOT NULL,
      description VARCHAR(255) NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_meta_data_format_recap_active (is_active, sort_order)
    )
  `);
  await runSafeMigration("ALTER TABLE meta_data_format_recap ADD COLUMN code VARCHAR(20) NULL AFTER id");
  await runSafeMigration("ALTER TABLE meta_data_format_recap ADD COLUMN description VARCHAR(255) NULL AFTER label");
  await runSafeMigration("ALTER TABLE meta_data_format_recap DROP COLUMN period_type");
  await runSafeMigration("ALTER TABLE meta_data_format_recap DROP COLUMN field_key");
  await runSafeMigration("ALTER TABLE meta_data_format_recap DROP COLUMN input_type");
  await runSafeMigration("ALTER TABLE meta_data_format_recap DROP COLUMN source_table");
  await runSafeMigration("ALTER TABLE meta_data_format_recap DROP COLUMN source_value_column");
  await runSafeMigration("ALTER TABLE meta_data_format_recap DROP COLUMN source_label_column");
  await runSafeMigration("ALTER TABLE meta_data_format_recap DROP COLUMN is_currency");
  await runSafeMigration("ALTER TABLE meta_data_format_recap DROP COLUMN is_required");
  await runSafeMigration("CREATE UNIQUE INDEX uniq_meta_data_format_recap_code ON meta_data_format_recap (code)");
  await runSafeMigration("CREATE INDEX idx_meta_data_format_recap_active ON meta_data_format_recap (is_active, sort_order)");

  await pool.query(
    `INSERT INTO meta_data_format_recap
      (code, label, description, is_active, sort_order)
     VALUES ?
     ON DUPLICATE KEY UPDATE
       label = VALUES(label),
       description = VALUES(description),
       is_active = VALUES(is_active),
       sort_order = VALUES(sort_order)`,
    [seedRecapFormats]
  );
  await runSafeMigration("UPDATE meta_data_format_recap SET is_active = FALSE WHERE code IS NULL");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS daily_recaps (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      format_recap_id INT UNSIGNED NOT NULL,
      recap_date DATE NOT NULL,
      user_id INT UNSIGNED NULL,
      shift_officer VARCHAR(150) NULL,
      transaction_total INT NOT NULL DEFAULT 0,
      offline_revenue DECIMAL(12,2) NOT NULL DEFAULT 0,
      online_revenue DECIMAL(12,2) NOT NULL DEFAULT 0,
      catering_revenue DECIMAL(12,2) NOT NULL DEFAULT 0,
      total_revenue DECIMAL(12,2) NOT NULL DEFAULT 0,
      hpp_total DECIMAL(12,2) NOT NULL DEFAULT 0,
      gross_profit DECIMAL(12,2) NOT NULL DEFAULT 0,
      daily_expense DECIMAL(12,2) NOT NULL DEFAULT 0,
      cash_in DECIMAL(12,2) NOT NULL DEFAULT 0,
      qris_in DECIMAL(12,2) NOT NULL DEFAULT 0,
      transfer_in DECIMAL(12,2) NOT NULL DEFAULT 0,
      cash_difference DECIMAL(12,2) NOT NULL DEFAULT 0,
      best_menu_item_id INT UNSIGNED NULL,
      best_menu_name VARCHAR(150) NULL,
      least_menu_item_id INT UNSIGNED NULL,
      least_menu_name VARCHAR(150) NULL,
      note TEXT NULL,
      created_by INT UNSIGNED NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_daily_recaps_format_recap_id (format_recap_id),
      INDEX idx_daily_recaps_date (recap_date),
      UNIQUE KEY uniq_daily_recaps_date (recap_date),
      INDEX idx_daily_recaps_user_id (user_id),
      CONSTRAINT fk_daily_recaps_format
        FOREIGN KEY (format_recap_id) REFERENCES meta_data_format_recap(id)
        ON DELETE RESTRICT,
      CONSTRAINT fk_daily_recaps_user
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE SET NULL,
      CONSTRAINT fk_daily_recaps_best_menu_item
        FOREIGN KEY (best_menu_item_id) REFERENCES menu_items(id)
        ON DELETE SET NULL,
      CONSTRAINT fk_daily_recaps_least_menu_item
        FOREIGN KEY (least_menu_item_id) REFERENCES menu_items(id)
        ON DELETE SET NULL,
      CONSTRAINT fk_daily_recaps_created_by
        FOREIGN KEY (created_by) REFERENCES users(id)
        ON DELETE SET NULL
    )
  `);
  await runSafeMigration("ALTER TABLE daily_recaps ADD COLUMN total_revenue DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER catering_revenue");
  await runSafeMigration("ALTER TABLE daily_recaps ADD COLUMN gross_profit DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER hpp_total");
  await runSafeMigration("ALTER TABLE daily_recaps ADD COLUMN cash_difference DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER transfer_in");
  await runSafeMigration("CREATE UNIQUE INDEX uniq_daily_recaps_date ON daily_recaps (recap_date)");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS weekly_recaps (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      format_recap_id INT UNSIGNED NOT NULL,
      period_start_date DATE NOT NULL,
      period_end_date DATE NOT NULL,
      total_omzet DECIMAL(12,2) NOT NULL DEFAULT 0,
      gross_profit DECIMAL(12,2) NOT NULL DEFAULT 0,
      offline_revenue DECIMAL(12,2) NOT NULL DEFAULT 0,
      online_revenue DECIMAL(12,2) NOT NULL DEFAULT 0,
      catering_revenue DECIMAL(12,2) NOT NULL DEFAULT 0,
      catering_order_count INT NOT NULL DEFAULT 0,
      top_channel VARCHAR(100) NULL,
      operational_issues TEXT NULL,
      team_evaluation TEXT NULL,
      stock_evaluation TEXT NULL,
      action_plan TEXT NULL,
      note TEXT NULL,
      created_by INT UNSIGNED NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_weekly_recaps_format_recap_id (format_recap_id),
      UNIQUE KEY uniq_weekly_recaps_period (period_start_date, period_end_date),
      CONSTRAINT fk_weekly_recaps_format
        FOREIGN KEY (format_recap_id) REFERENCES meta_data_format_recap(id)
        ON DELETE RESTRICT,
      CONSTRAINT fk_weekly_recaps_created_by
        FOREIGN KEY (created_by) REFERENCES users(id)
        ON DELETE SET NULL
    )
  `);
  await runSafeMigration("ALTER TABLE weekly_recaps ADD COLUMN catering_revenue DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER online_revenue");
  await runSafeMigration("ALTER TABLE weekly_recaps ADD COLUMN catering_order_count INT NOT NULL DEFAULT 0 AFTER catering_revenue");
  await runSafeMigration("ALTER TABLE weekly_recaps ADD COLUMN top_channel VARCHAR(100) NULL AFTER catering_order_count");
  await runSafeMigration("ALTER TABLE weekly_recaps ADD COLUMN operational_issues TEXT NULL AFTER top_channel");
  await runSafeMigration("ALTER TABLE weekly_recaps ADD COLUMN team_evaluation TEXT NULL AFTER operational_issues");
  await runSafeMigration("ALTER TABLE weekly_recaps ADD COLUMN stock_evaluation TEXT NULL AFTER team_evaluation");
  await runSafeMigration("ALTER TABLE weekly_recaps ADD COLUMN action_plan TEXT NULL AFTER stock_evaluation");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS monthly_recaps (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      format_recap_id INT UNSIGNED NOT NULL,
      period_month CHAR(7) NOT NULL,
      omzet DECIMAL(12,2) NOT NULL DEFAULT 0,
      hpp_total DECIMAL(12,2) NOT NULL DEFAULT 0,
      gross_profit DECIMAL(12,2) NOT NULL DEFAULT 0,
      estimated_net_profit DECIMAL(12,2) NOT NULL DEFAULT 0,
      catering_order_count INT NOT NULL DEFAULT 0,
      retained_menu TEXT NULL,
      evaluated_menu TEXT NULL,
      promotion_evaluation TEXT NULL,
      supplier_evaluation TEXT NULL,
      next_month_strategy TEXT NULL,
      note TEXT NULL,
      created_by INT UNSIGNED NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_monthly_recaps_format_recap_id (format_recap_id),
      UNIQUE KEY uniq_monthly_recaps_period (period_month),
      CONSTRAINT fk_monthly_recaps_format
        FOREIGN KEY (format_recap_id) REFERENCES meta_data_format_recap(id)
        ON DELETE RESTRICT,
      CONSTRAINT fk_monthly_recaps_created_by
        FOREIGN KEY (created_by) REFERENCES users(id)
        ON DELETE SET NULL
    )
  `);
  await runSafeMigration("ALTER TABLE monthly_recaps ADD COLUMN catering_order_count INT NOT NULL DEFAULT 0 AFTER estimated_net_profit");
  await runSafeMigration("ALTER TABLE monthly_recaps ADD COLUMN retained_menu TEXT NULL AFTER catering_order_count");
  await runSafeMigration("ALTER TABLE monthly_recaps ADD COLUMN evaluated_menu TEXT NULL AFTER retained_menu");
  await runSafeMigration("ALTER TABLE monthly_recaps ADD COLUMN promotion_evaluation TEXT NULL AFTER evaluated_menu");
  await runSafeMigration("ALTER TABLE monthly_recaps ADD COLUMN supplier_evaluation TEXT NULL AFTER promotion_evaluation");
  await runSafeMigration("ALTER TABLE monthly_recaps ADD COLUMN next_month_strategy TEXT NULL AFTER supplier_evaluation");

  console.log(`MySQL Connected: ${config.dbHost}/${config.dbName}`);
};

module.exports = { pool, connectDB };
