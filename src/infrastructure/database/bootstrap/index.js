// Startup schema management: runs on every boot before the server listens.
// Every statement must stay idempotent; see docs/architecture.md.
const config = require("../../../config/env");
const logger = require("../../../shared/logger");
const { roundCurrency } = require("../../../shared/utils/money");
const { pool, serverPool } = require("../pool");
const { runSafeMigration } = require("./helpers");
const {
  migrateLegacyMenuOptions,
  removeSinglePriceSizeSpecificIngredients,
  replaceMenuItemOptions,
  seedDefaultMenuIngredients,
} = require("./menuCatalog");
const { backfillMonthlyOrderCodes } = require("./orderCodes");
const {
  backfillOrderPlatformRelations,
  createMetaDataPlatformTable,
  createOrderPlatformRelationTable,
  migrateLegacyOrderPlatformMaster,
  seedMetaDataPlatforms,
} = require("./platforms");
const {
  getSeedSizeFinancials,
  getSeedTemperatureVariants,
  seedCategories,
  seedMenuCatalog,
  seedMenuFinancials,
  seedRecapFormats,
  seedStockItems,
  shouldUseSinglePrice,
} = require("./seedData");
const { ensureShoppingSchema } = require("./shoppingSchema");

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
      regular_price DECIMAL(12,2) NULL,
      online_price DECIMAL(12,2) NULL,
      include_online_platform BOOLEAN NOT NULL DEFAULT FALSE,
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
  await runSafeMigration("ALTER TABLE menu_items CHANGE COLUMN price regular_price DECIMAL(12,2) NULL");
  await runSafeMigration("ALTER TABLE menu_items ADD COLUMN online_price DECIMAL(12,2) NULL AFTER regular_price");
  await runSafeMigration("ALTER TABLE menu_items ADD COLUMN include_online_platform BOOLEAN NOT NULL DEFAULT FALSE AFTER online_price");
  await runSafeMigration("UPDATE menu_items SET include_online_platform = TRUE WHERE online_price IS NOT NULL");
  await runSafeMigration("ALTER TABLE menu_items ADD COLUMN hpp_cost DECIMAL(12,2) NULL AFTER include_online_platform");
  await runSafeMigration("ALTER TABLE menu_items ADD COLUMN gross_profit DECIMAL(12,2) NULL AFTER hpp_cost");
  await runSafeMigration("ALTER TABLE menu_items DROP COLUMN gross_profit_margin");
  await runSafeMigration("ALTER TABLE menu_items MODIFY COLUMN regular_price DECIMAL(12,2) NULL");
  await runSafeMigration("ALTER TABLE menu_items MODIFY COLUMN online_price DECIMAL(12,2) NULL");
  await runSafeMigration("ALTER TABLE menu_items MODIFY COLUMN hpp_cost DECIMAL(12,2) NULL");
  await runSafeMigration("ALTER TABLE menu_items MODIFY COLUMN gross_profit DECIMAL(12,2) NULL");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS menu_seed_exclusions (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(150) NOT NULL UNIQUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

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
    SET mi.regular_price = NULL,
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
  await runSafeMigration("ALTER TABLE menu_items DROP COLUMN large_price");
  await runSafeMigration("ALTER TABLE menu_items DROP COLUMN variants_json");
  await runSafeMigration("ALTER TABLE menu_items DROP COLUMN sizes_json");

  await createMetaDataPlatformTable();
  await migrateLegacyOrderPlatformMaster();
  await seedMetaDataPlatforms();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS stock_items (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(150) NOT NULL UNIQUE,
      category VARCHAR(100) NOT NULL,
      unit VARCHAR(30) NOT NULL,
      stock DECIMAL(12,2) NOT NULL DEFAULT 0,
      minimum_stock DECIMAL(12,2) NOT NULL DEFAULT 0,
      average_cost DECIMAL(14,4) NOT NULL DEFAULT 0,
      stock_value DECIMAL(14,2) NOT NULL DEFAULT 0,
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
  await runSafeMigration("ALTER TABLE stock_items ADD COLUMN average_cost DECIMAL(14,4) NOT NULL DEFAULT 0 AFTER minimum_stock");
  await runSafeMigration("ALTER TABLE stock_items ADD COLUMN stock_value DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER average_cost");

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
  const [seedExclusionRows] = await pool.query(
    "SELECT name FROM menu_seed_exclusions"
  );
  const seedExcludedMenuNames = new Set(
    seedExclusionRows.map((row) => String(row.name || "").trim()).filter(Boolean)
  );

  for (const seedMenuItem of seedMenuCatalog) {
    const [categoryName, name, regularPrice, largePriceOrImageUrl, maybeImageUrl] =
      seedMenuItem;
    if (seedExcludedMenuNames.has(name)) continue;

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
             regular_price = COALESCE(regular_price, ?),
             hpp_cost = COALESCE(hpp_cost, ?),
             gross_profit = COALESCE(gross_profit, ?),
             image_path = COALESCE(NULLIF(image_path, ''), ?)
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
          (category_id, name, regular_price, online_price, include_online_platform, hpp_cost, gross_profit, image_path, is_available)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, TRUE)`,
        [
          categoryId,
          name,
          sizes.length ? null : regularPrice,
          null,
          false,
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
      AND mis.price = mi.regular_price
  `);
  await seedDefaultMenuIngredients();
  await removeSinglePriceSizeSpecificIngredients();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      order_code VARCHAR(40) UNIQUE,
      customer_name VARCHAR(100) NOT NULL,
      customer_phone VARCHAR(50) NULL,
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
      note TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  await runSafeMigration("ALTER TABLE orders ADD COLUMN note TEXT NULL AFTER payment_method");
  await runSafeMigration("ALTER TABLE orders ADD COLUMN order_code VARCHAR(40) UNIQUE AFTER id");
  await runSafeMigration("ALTER TABLE orders ADD COLUMN customer_phone VARCHAR(50) NULL AFTER customer_name");
  await runSafeMigration("ALTER TABLE orders ADD COLUMN order_type VARCHAR(50) NOT NULL DEFAULT 'Offline' AFTER guests");
  await runSafeMigration("ALTER TABLE orders ADD COLUMN order_platform VARCHAR(100) NULL AFTER order_type");
  await runSafeMigration("ALTER TABLE orders ADD COLUMN online_order_charge DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER total");
  await runSafeMigration("UPDATE orders SET order_type = 'Offline' WHERE order_type = 'Dine In'");
  await runSafeMigration("UPDATE orders SET order_type = 'Online' WHERE order_type = 'Online Order'");
  await backfillMonthlyOrderCodes();
  await pool.query("UPDATE orders SET order_status = 'Completed' WHERE order_status = 'Ready'");
  await runSafeMigration("ALTER TABLE orders DROP FOREIGN KEY fk_orders_table");
  await runSafeMigration("DROP INDEX idx_orders_table_id ON orders");
  await runSafeMigration("ALTER TABLE orders DROP COLUMN table_id");

  await createOrderPlatformRelationTable();
  await backfillOrderPlatformRelations();

  await runSafeMigration("DROP TABLE IF EXISTS order_online_transactions");
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

  await runSafeMigration("DROP TABLE IF EXISTS payments");

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

  logger.info(`MySQL Connected: ${config.dbHost}/${config.dbName}`);
};


const bootstrapDatabase = async () => {
  await connectDB();
  await ensureShoppingSchema(pool);
};

module.exports = { bootstrapDatabase, connectDB };
