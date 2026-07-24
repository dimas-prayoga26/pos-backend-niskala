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
  ["Coffee", "Cappuccino", 18000, 21000, menuImage("cappuccino.jpg")],
  ["Coffee", "Cafe Latte", 18000, 21000, menuImage("cafe-latte.jpg")],
  ["Coffee", "Butterscotch Latte", 20000, 23000, menuImage("butterscotch-latte.jpg")],
  ["Coffee", "Caramel Latte", 20000, 23000, menuImage("caramel-latte.jpg")],
  ["Coffee", "Vanilla Latte", 20000, 23000, menuImage("vanilla-latte.jpg")],
  ["Coffee", "Hazelnut Latte", 20000, 23000, menuImage("hazelnut-latte.jpg")],
  ["Coffee", "Aren Latte", 20000, 23000, menuImage("aren-latte.jpg")],
  ["Coffee", "Moccacino", 22000, 25000, menuImage("moccacino.jpg")],
  ["Coffee", "Berry Coffee Milk", 22000, 25000, menuImage("berry-coffee-milk.jpg")],
  ["Coffee", "Americano", 15000, 18000, menuImage("americano.jpg")],
  ["Coffee", "Longblack", 15000, 18000, menuImage("longblack.jpg")],
  ["Coffee", "On The Rock Espresso", 15000, 18000, menuImage("on-the-rock-espresso.jpg")],
  ["Coffee", "Tropical Americano", 23000, 26000, menuImage("tropical-americano.jpg")],
  ["Coffee", "Elberry Americano", 23000, 26000, menuImage("elberry-americano.jpg")],
  ["Coffee", "Berry Summer", 23000, 26000, menuImage("berry-summer.jpg")],
  ["Non-Coffee", "Chocolate", 18000, 21000, menuImage("chocolate.jpg")],
  ["Non-Coffee", "Matcha", 18000, 21000, menuImage("matcha.jpg")],
  ["Non-Coffee", "Cookies and Cream", 18000, 21000, menuImage("cookies-and-cream.jpg")],
  ["Non-Coffee", "Lychee Tea", 13000, 16000, menuImage("lychee-tea.jpg")],
  ["Non-Coffee", "Lemon Tea", 13000, 16000, menuImage("lemon-tea.jpg")],
  ["Non-Coffee", "Jeruk Nipis Songkit", 13000, 16000, menuImage("jeruk-nipis-songkit.jpg")],
  ["Non-Coffee", "Thai Tea", 15000, 18000, menuImage("thai-tea.jpg")],
  ["Main Course", "Fried Egg Rice Bowl", 15000, menuImage("fried-egg-rice-bowl.jpg")],
  ["Main Course", "Chicken Katsu Rice Bowl", 25000, menuImage("chicken-katsu-rice-bowl.jpg")],
  ["Main Course", "Chicken Teriyaki Rice Bowl", 23000, menuImage("chicken-teriyaki-rice-bowl.jpg")],
  ["Main Course", "Ayam Geprek Rice Bowl", 22000, menuImage("ayam-geprek-rice-bowl.jpg")],
  ["Main Course", "Beef Teriyaki Rice Bowl", 25000, menuImage("beef-teriyaki-rice-bowl.jpg")],
  ["Main Course", "Indomie Goreng Telur", 15000, menuImage("indomie-goreng-telur.jpg")],
  ["Main Course", "Indomie Rebus Telur", 15000, menuImage("indomie-rebus-telur.jpg")],
  ["Snack", "Kentang Goreng", 12000, menuImage("kentang-goreng.jpg")],
  ["Snack", "Mix Platter", 22000, menuImage("mix-platter.jpg")],
  ["Snack", "Cireng", 12000, menuImage("cireng.jpg")],
  ["Snack", "Pisang Nugget Keju Coklat", 18000, menuImage("pisang-nugget-keju-coklat.jpg")],
  ["Snack", "Roti Bakar", 15000, menuImage("roti-bakar.jpg")],
  ["Catering", "Paket 20K / Box", 20000, menuImage("catering-paket-20k.jpg")],
  ["Catering", "Paket 28K / Box", 28000, menuImage("catering-paket-28k.jpg")],
  ["Catering", "Paket 30K / Box", 30000, menuImage("catering-paket-30k.jpg")],
  ["Catering", "Paket 35K / Box", 35000, menuImage("catering-paket-35k.jpg")],
  ["Catering", "Paket 40K / Box", 40000, menuImage("catering-paket-40k.jpg")],
];

const seedAddOns = [
  ["nasi-putih", "Nasi Putih", 4000, menuImage("addon-nasi-putih.jpg")],
  ["telur", "Telur", 5000, menuImage("addon-telur.jpg")],
  ["buah", "Buah", 5000, menuImage("addon-buah.jpg")],
  ["sambal", "Sambal", 4000, menuImage("addon-sambal.jpg")],
  ["kerupuk", "Kerupuk", 3000, menuImage("addon-kerupuk.jpg")],
  ["air-mineral", "Air Mineral", 5000, menuImage("addon-air-mineral.jpg")],
];

const seedStockItems = [
  ["Ayam Fillet", "Makanan", "kg", 4, 5, "Supplier Ayam Segar"],
  ["Kentang Beku", "Snack", "kg", 2.5, 3, "Frozen Food Mandiri"],
  ["Powder Matcha", "Powder", "kg", 0.3, 0.5, "Toko Bahan Minuman"],
  ["Beras", "Makanan", "kg", 17, 15, "Toko Beras Makmur"],
  ["Cup 16 oz + tutup", "Packaging", "pak(50)", 5, 4, "Toko Kemasan"],
  ["Gula Aren Cair", "Sirup", "botol", 3, 2, "UMKM Aren Jaya"],
];

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
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
  await runSafeMigration("ALTER TABLE categories DROP COLUMN bg_color");
  await runSafeMigration("ALTER TABLE categories ADD COLUMN tax DECIMAL(5,2) NULL AFTER icon");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS menu_items (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      category_id INT UNSIGNED NOT NULL,
      name VARCHAR(150) NOT NULL,
      price DECIMAL(12,2) NOT NULL,
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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS menu_item_sizes (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      menu_item_id INT UNSIGNED NOT NULL,
      name VARCHAR(80) NOT NULL,
      price DECIMAL(12,2) NOT NULL,
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
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_stock_items_category (category),
      INDEX idx_stock_items_is_active (is_active)
    )
  `);

  await pool.query(
    `INSERT INTO stock_items
      (name, category, unit, stock, minimum_stock, supplier)
     VALUES ?
     ON DUPLICATE KEY UPDATE
       category = VALUES(category),
       unit = VALUES(unit),
       supplier = VALUES(supplier),
       is_active = TRUE`,
    [seedStockItems]
  );

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
       icon = VALUES(icon),
       is_active = TRUE`,
    [seedCategories]
  );

  await deactivateRowsOutsideList(
    "categories",
    "name",
    "is_active",
    seedCategories.map(([name]) => name)
  );

  const [categoryRows] = await pool.query(
    `SELECT id, name FROM categories
     WHERE name IN (${seedCategories.map(() => "?").join(", ")})`,
    seedCategories.map(([name]) => name)
  );
  const categoryIdByName = new Map(
    categoryRows.map((category) => [category.name, category.id])
  );

  for (const seedMenuItem of seedMenuItems) {
    const [categoryName, name, regularPrice, largePriceOrImageUrl, maybeImageUrl] =
      seedMenuItem;
    const hasLargePrice = typeof largePriceOrImageUrl === "number";
    const largePrice = hasLargePrice ? largePriceOrImageUrl : null;
    const imagePathCandidate = hasLargePrice
      ? maybeImageUrl
      : largePriceOrImageUrl;
    const seedImagePath =
      typeof imagePathCandidate === "string" &&
      imagePathCandidate.startsWith("/uploads/")
        ? imagePathCandidate
        : null;
    const variants = hasLargePrice ? ["Cold", "Hot"] : [];
    const sizes = hasLargePrice
      ? [
          { name: "Reguler", price: regularPrice },
          { name: "Large", price: largePrice },
        ]
      : [];
    const categoryId = categoryIdByName.get(categoryName);
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
             image_path = COALESCE(image_path, ?),
             is_available = TRUE
         WHERE id = ?`,
        [
          categoryId,
          regularPrice,
          seedImagePath,
          menuItemId,
        ]
      );
    } else {
      const [result] = await pool.query(
        `INSERT INTO menu_items
          (category_id, name, price, image_path, is_available)
         VALUES (?, ?, ?, ?, TRUE)`,
        [
          categoryId,
          name,
          regularPrice,
          seedImagePath,
        ]
      );
      menuItemId = result.insertId;
    }

    await replaceMenuItemOptions(menuItemId, { sizes, variants });
  }
  await deactivateRowsOutsideList(
    "menu_items",
    "name",
    "is_available",
    seedMenuItems.map(([, name]) => name)
  );
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
      name VARCHAR(150) NOT NULL,
      variant VARCHAR(50) NULL,
      quantity INT NOT NULL,
      price_per_quantity DECIMAL(12,2) NOT NULL,
      price DECIMAL(12,2) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_order_items_order_id (order_id),
      CONSTRAINT fk_order_items_order
        FOREIGN KEY (order_id) REFERENCES orders(id)
        ON DELETE CASCADE
    )
  `);
  await runSafeMigration("ALTER TABLE order_items ADD COLUMN variant VARCHAR(50) NULL AFTER name");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS add_ons (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      code VARCHAR(80) NOT NULL UNIQUE,
      name VARCHAR(120) NOT NULL,
      price DECIMAL(12,2) NOT NULL DEFAULT 0,
      image_path VARCHAR(255),
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  await runSafeMigration("ALTER TABLE add_ons DROP FOREIGN KEY fk_add_ons_category");
  await runSafeMigration("DROP INDEX idx_add_ons_category_id ON add_ons");
  await runSafeMigration("ALTER TABLE add_ons DROP COLUMN category_id");
  await runSafeMigration("ALTER TABLE add_ons ADD COLUMN image_path VARCHAR(255) NULL AFTER price");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS order_item_addons (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      order_item_id INT UNSIGNED NOT NULL,
      add_on_id INT UNSIGNED NULL,
      name VARCHAR(120) NOT NULL,
      price DECIMAL(12,2) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_order_item_addons_order_item_id (order_item_id),
      INDEX idx_order_item_addons_add_on_id (add_on_id),
      CONSTRAINT fk_order_item_addons_order_item
        FOREIGN KEY (order_item_id) REFERENCES order_items(id)
        ON DELETE CASCADE,
      CONSTRAINT fk_order_item_addons_add_on
        FOREIGN KEY (add_on_id) REFERENCES add_ons(id)
        ON DELETE SET NULL
    )
  `);

  await pool.query(
    `INSERT INTO add_ons (code, name, price, image_path)
     VALUES ?
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       price = VALUES(price),
       image_path = COALESCE(image_path, VALUES(image_path)),
       is_active = TRUE`,
    [seedAddOns]
  );
  await deactivateRowsOutsideList(
    "add_ons",
    "code",
    "is_active",
    seedAddOns.map(([code]) => code)
  );

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
