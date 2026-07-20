const mysql = require("mysql2/promise");
const config = require("./config");

const pool = mysql.createPool({
  host: config.dbHost,
  port: config.dbPort,
  user: config.dbUser,
  password: config.dbPassword,
  database: config.dbName,
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: true,
});

const serverPool = mysql.createPool({
  host: config.dbHost,
  port: config.dbPort,
  user: config.dbUser,
  password: config.dbPassword,
  waitForConnections: true,
  connectionLimit: 2,
});

const runSafeMigration = async (query) => {
  try {
    await pool.query(query);
  } catch (error) {
    // Keeps startup idempotent across fresh and already-migrated databases.
  }
};

const commonsImage = (fileName) =>
  `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(
    fileName
  ).replace(/%20/g, "_")}`;

const seedCategories = [
  ["Coffee", "\u2615"],
  ["Non-Coffee", "\u{1F964}"],
  ["Main Course", "\u{1F35A}"],
  ["Snack", "\u{1F35F}"],
  ["Catering", "\u{1F371}"],
  ["Add Ons", "\u2795"],
];

const seedMenuItems = [
  ["Coffee", "Espresso", 10000, commonsImage("Espresso BW 1.jpg")],
  ["Coffee", "Americano", 15000, commonsImage("Cappuccino at Sightglass Coffee.jpg")],
  ["Coffee", "Cappuccino", 18000, commonsImage("Cappuccino at Sightglass Coffee.jpg")],
  ["Coffee", "Latte", 18000, commonsImage("Cappuccino at Sightglass Coffee.jpg")],
  ["Coffee", "Lemon Coffee", 20000, commonsImage("Cappuccino at Sightglass Coffee.jpg")],
  ["Coffee", "Palm Sugar Coffee", 20000, commonsImage("Cappuccino at Sightglass Coffee.jpg")],
  ["Coffee", "Tubruk Robusta", 8000, commonsImage("Roasted coffee beans.jpg")],
  ["Coffee", "Tubruk Arabika", 15000, commonsImage("Coffee Beans closeup.jpg")],
  ["Non-Coffee", "Strawberry Yakult", 18000, commonsImage("Strawberry milk shake (cropped).jpg")],
  ["Non-Coffee", "Taro", 20000, commonsImage("Strawberry milk shake (cropped).jpg")],
  ["Non-Coffee", "Matcha", 20000, commonsImage("Matcha latte.jpg")],
  ["Non-Coffee", "Chocolate", 18000, commonsImage("Hot chocolate.jpg")],
  ["Non-Coffee", "Tea", 8000, commonsImage("Cup of tea.jpg")],
  ["Non-Coffee", "Lemon Tea", 15000, commonsImage("Thai iced tea.jpg")],
  ["Non-Coffee", "Strawberry Tea", 15000, commonsImage("Strawberry cocktail drink (Unsplash).jpg")],
  ["Non-Coffee", "Thai Tea", 15000, commonsImage("Thai iced tea.jpg")],
  ["Main Course", "Fried Egg Rice Bowl", 15000, commonsImage("Nasi Goreng Breakfast in Solo.JPG")],
  ["Main Course", "Chicken Katsu Rice Bowl", 25000, commonsImage("Chicken teriyaki.jpg")],
  ["Main Course", "Chicken Teriyaki Rice Bowl", 23000, commonsImage("Osaka Teriyaki Rice Bowl.jpg")],
  ["Main Course", "Ayam Geprek Rice Bowl", 22000, commonsImage("Ayam Geprek.jpg")],
  ["Main Course", "Beef Teriyaki Rice Bowl", 25000, commonsImage("Bowl of Teriyaki chicken and beef YakinikuCNE.jpg")],
  ["Main Course", "Indomie Goreng Telur", 15000, commonsImage("Indomie Mie Goreng Iga Penyet 1.JPG")],
  ["Main Course", "Indomie Rebus Telur", 15000, commonsImage("Indomie Mie Goreng Iga Penyet 2.JPG")],
  ["Snack", "Kentang Goreng", 12000, commonsImage("McDonalds-French-Fries-Plate.jpg")],
  ["Snack", "Mix Platter", 22000, commonsImage("McDonalds-French-Fries-Plate.jpg")],
  ["Snack", "Cireng", 12000, commonsImage("Cireng indonesian snack.jpg")],
  ["Snack", "Pisang Nugget Keju Coklat", 18000, commonsImage("Pisang keju.jpg")],
  ["Snack", "Roti Bakar", 15000, commonsImage("Roti bakar.jpg")],
  ["Catering", "Paket 20K / Box", 20000, commonsImage("Nasi Kotak-1.jpg")],
  ["Catering", "Paket 28K / Box", 28000, commonsImage("Indonesian Rice Box.jpg")],
  ["Catering", "Paket 30K / Box", 30000, commonsImage("Nasi kuning kotak box.jpg")],
  ["Catering", "Paket 35K / Box", 35000, commonsImage("Nasi Kotak-2.jpg")],
  ["Catering", "Paket 40K / Box", 40000, commonsImage("Rice box bento in Indonesia.jpg")],
];

const seedAddOns = [
  ["nasi-putih", "Nasi Putih", 4000],
  ["telur", "Telur", 5000],
  ["buah", "Buah", 5000],
  ["sambal", "Sambal", 4000],
  ["kerupuk", "Kerupuk", 3000],
  ["air-mineral", "Air Mineral", 5000],
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
      image_url VARCHAR(255),
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

  for (const [categoryName, name, price, imageUrl] of seedMenuItems) {
    const categoryId = categoryIdByName.get(categoryName);
    if (!categoryId) continue;

    const [existingRows] = await pool.query(
      "SELECT id FROM menu_items WHERE name = ? LIMIT 1",
      [name]
    );

    if (existingRows.length) {
      await pool.query(
        `UPDATE menu_items
         SET category_id = ?, price = ?, image_url = ?, is_available = TRUE
         WHERE id = ?`,
        [categoryId, price, imageUrl, existingRows[0].id]
      );
    } else {
      await pool.query(
        `INSERT INTO menu_items
          (category_id, name, price, image_url, is_available)
         VALUES (?, ?, ?, ?, TRUE)`,
        [categoryId, name, price, imageUrl]
      );
    }
  }
  await deactivateRowsOutsideList(
    "menu_items",
    "name",
    "is_available",
    seedMenuItems.map(([, name]) => name)
  );

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
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  await runSafeMigration("ALTER TABLE add_ons DROP FOREIGN KEY fk_add_ons_category");
  await runSafeMigration("DROP INDEX idx_add_ons_category_id ON add_ons");
  await runSafeMigration("ALTER TABLE add_ons DROP COLUMN category_id");

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
    `INSERT INTO add_ons (code, name, price)
     VALUES ?
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       price = VALUES(price),
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

  console.log(`MySQL Connected: ${config.dbHost}/${config.dbName}`);
};

module.exports = { pool, connectDB };
