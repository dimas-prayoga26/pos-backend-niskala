CREATE DATABASE IF NOT EXISTS `pos_system` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `pos_system`;

CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  phone VARCHAR(30) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

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
);

CREATE TABLE IF NOT EXISTS menu_items (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  category_id INT UNSIGNED NOT NULL,
  name VARCHAR(150) NOT NULL,
  include_online_platform BOOLEAN NOT NULL DEFAULT FALSE,
  image_path VARCHAR(255),
  is_available BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_menu_items_category_id (category_id),
  CONSTRAINT fk_menu_items_category
    FOREIGN KEY (category_id) REFERENCES categories(id)
    ON DELETE CASCADE
);

-- Price, online price, HPP and gross profit of a menu item (one row per menu).
CREATE TABLE IF NOT EXISTS menu_item_prices (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  menu_item_id INT UNSIGNED NOT NULL,
  regular_price DECIMAL(12,2) NOT NULL,
  online_price DECIMAL(12,2) NULL,
  hpp_cost DECIMAL(12,2) NOT NULL DEFAULT 0,
  gross_profit DECIMAL(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_menu_item_prices_menu_item (menu_item_id),
  CONSTRAINT fk_menu_item_prices_menu_item
    FOREIGN KEY (menu_item_id) REFERENCES menu_items(id)
    ON DELETE CASCADE
);

-- Bahan baku (raw items), bought through belanja.
CREATE TABLE IF NOT EXISTS stock_raw_items (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL UNIQUE,
  category VARCHAR(100) NOT NULL,
  unit VARCHAR(30) NOT NULL,
  stock DECIMAL(12,2) NOT NULL DEFAULT 0,
  minimum_stock DECIMAL(12,2) NOT NULL DEFAULT 0,
  unit_cost INT NOT NULL DEFAULT 0,
  stock_value DECIMAL(14,2) NOT NULL DEFAULT 0,
  supplier VARCHAR(150),
  is_unlimited BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_stock_raw_items_category (category),
  INDEX idx_stock_raw_items_is_active (is_active)
);

-- Bahan setengah jadi (e.g. Nasi from Beras), counted in portions and cooked
-- from bahan baku ("Catat Masak"), never bought.
CREATE TABLE IF NOT EXISTS stock_semi_items (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL UNIQUE,
  category VARCHAR(100) NOT NULL,
  unit VARCHAR(30) NOT NULL,
  stock DECIMAL(12,2) NOT NULL DEFAULT 0,
  minimum_stock DECIMAL(12,2) NOT NULL DEFAULT 0,
  -- Moving average per portion, whole rupiah.
  unit_cost INT NOT NULL DEFAULT 0,
  stock_value DECIMAL(14,2) NOT NULL DEFAULT 0,
  -- Weight (gr) of one portion of the cooked result.
  portion_size DOUBLE NOT NULL DEFAULT 0,
  -- Portions per recipe found by the latest cooking (0 = never cooked).
  yield_quantity DOUBLE NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_stock_semi_items_is_active (is_active)
);

CREATE TABLE IF NOT EXISTS suplier (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS history_stock_purchases (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  request_id VARCHAR(64) NOT NULL UNIQUE,
  payload_hash CHAR(64) NOT NULL,
  purchase_date DATE NOT NULL,
  suplier_id INT UNSIGNED NOT NULL,
  suplier_name VARCHAR(150) NOT NULL,
  payment_method VARCHAR(80) NOT NULL,
  note VARCHAR(500) NOT NULL DEFAULT '',
  total DECIMAL(14,2) NOT NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_stock_purchases_date (purchase_date, id),
  CONSTRAINT fk_stock_purchases_suplier
    FOREIGN KEY (suplier_id) REFERENCES suplier(id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_stock_purchases_created_by
    FOREIGN KEY (created_by) REFERENCES users(id)
    ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS history_stock_purchase_items (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  purchase_id INT UNSIGNED NOT NULL,
  stock_item_id INT UNSIGNED NULL,
  item_name VARCHAR(150) NOT NULL,
  quantity DECIMAL(12,3) NOT NULL,
  unit VARCHAR(30) NOT NULL,
  unit_price DECIMAL(14,2) NOT NULL,
  total DECIMAL(14,2) NOT NULL,
  stock_quantity DECIMAL(12,2) NOT NULL,
  stock_unit VARCHAR(30) NOT NULL,
  stock_unit_cost INT NOT NULL DEFAULT 0,
  stock_value_after DECIMAL(14,2) NOT NULL DEFAULT 0,
  CONSTRAINT fk_stock_purchase_items_purchase
    FOREIGN KEY (purchase_id) REFERENCES history_stock_purchases(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_stock_purchase_items_stock_item
    FOREIGN KEY (stock_item_id) REFERENCES stock_raw_items(id)
    ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS history_stock_purchase_item_logs (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  purchase_item_id INT UNSIGNED NULL,
  purchase_id INT UNSIGNED NULL,
  stock_item_id INT UNSIGNED NULL,
  item_name VARCHAR(150) NOT NULL,
  action VARCHAR(20) NOT NULL,
  old_data JSON NULL,
  new_data JSON NULL,
  user_id INT UNSIGNED NULL,
  user_name VARCHAR(150) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_stock_purchase_item_logs_item (stock_item_id, created_at),
  INDEX idx_stock_purchase_item_logs_purchase_item (purchase_item_id, created_at),
  CONSTRAINT fk_stock_purchase_item_logs_purchase_item
    FOREIGN KEY (purchase_item_id) REFERENCES history_stock_purchase_items(id)
    ON DELETE SET NULL,
  CONSTRAINT fk_stock_purchase_item_logs_purchase
    FOREIGN KEY (purchase_id) REFERENCES history_stock_purchases(id)
    ON DELETE SET NULL,
  CONSTRAINT fk_stock_purchase_item_logs_stock_item
    FOREIGN KEY (stock_item_id) REFERENCES stock_raw_items(id)
    ON DELETE SET NULL,
  CONSTRAINT fk_stock_purchase_item_logs_user
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE SET NULL
);

-- Recipes: pivot menu_items <-> stock items, one row per ingredient: either a
-- bahan baku (stock_item_id) or a bahan setengah jadi (semi_item_id).
-- Quantities are in that item's unit.
CREATE TABLE IF NOT EXISTS recipes (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  menu_item_id INT UNSIGNED NOT NULL,
  stock_item_id INT UNSIGNED NULL,
  semi_item_id INT UNSIGNED NULL,
  quantity DOUBLE NOT NULL DEFAULT 0,
  -- quantity x the item's unit_cost in whole rupiah, kept up to date by the app.
  cost INT NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  note VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_recipes_menu_stock (menu_item_id, stock_item_id),
  UNIQUE KEY uniq_recipes_menu_semi (menu_item_id, semi_item_id),
  INDEX idx_recipes_stock_item_id (stock_item_id),
  INDEX idx_recipes_semi_item_id (semi_item_id),
  CONSTRAINT fk_recipes_menu_item
    FOREIGN KEY (menu_item_id) REFERENCES menu_items(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_recipes_stock_item
    FOREIGN KEY (stock_item_id) REFERENCES stock_raw_items(id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_recipes_semi_item
    FOREIGN KEY (semi_item_id) REFERENCES stock_semi_items(id)
    ON DELETE RESTRICT,
  CONSTRAINT chk_recipes_one_item
    CHECK ((stock_item_id IS NULL) <> (semi_item_id IS NULL))
);

-- Recipes with menu and stock names, for reading (e.g. in phpMyAdmin).
CREATE OR REPLACE SQL SECURITY INVOKER VIEW recipe_details AS
SELECT
  r.id,
  mi.name AS menu_name,
  IF(r.semi_item_id IS NULL, 'Bahan baku', 'Setengah jadi') AS item_type,
  COALESCE(si.name, ss.name) AS stock_item_name,
  r.quantity,
  COALESCE(si.unit, ss.unit) AS unit,
  COALESCE(si.unit_cost, ss.unit_cost) AS unit_cost,
  r.cost,
  r.note,
  r.menu_item_id,
  r.stock_item_id,
  r.semi_item_id,
  r.sort_order
FROM recipes r
JOIN menu_items mi ON mi.id = r.menu_item_id
LEFT JOIN stock_raw_items si ON si.id = r.stock_item_id
LEFT JOIN stock_semi_items ss ON ss.id = r.semi_item_id
ORDER BY mi.name, r.sort_order, r.id;

-- Composition of one recipe (batch) of a bahan setengah jadi, in each bahan
-- baku's unit.
CREATE TABLE IF NOT EXISTS stock_semi_item_recipes (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  semi_item_id INT UNSIGNED NOT NULL,
  stock_item_id INT UNSIGNED NOT NULL,
  quantity DOUBLE NOT NULL DEFAULT 0,
  -- quantity x stock unit_cost in whole rupiah, kept up to date by the app.
  cost INT NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  note VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_stock_semi_item_recipes_item_stock (semi_item_id, stock_item_id),
  INDEX idx_stock_semi_item_recipes_stock_item_id (stock_item_id),
  CONSTRAINT fk_stock_semi_item_recipes_semi_item
    FOREIGN KEY (semi_item_id) REFERENCES stock_semi_items(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_stock_semi_item_recipes_stock_item
    FOREIGN KEY (stock_item_id) REFERENCES stock_raw_items(id)
    ON DELETE RESTRICT
);

-- One row per cooking ("Catat Masak"): batch_quantity recipes gave
-- portion_quantity portions (output_weight / portion_size when weighed).
CREATE TABLE IF NOT EXISTS stock_semi_item_productions (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  semi_item_id INT UNSIGNED NULL,
  item_name VARCHAR(150) NOT NULL,
  batch_quantity DOUBLE NOT NULL,
  output_weight DOUBLE NULL,
  portion_quantity DECIMAL(12,2) NOT NULL,
  cost DECIMAL(14,2) NOT NULL DEFAULT 0,
  -- cost / portion_quantity of this cooking, whole rupiah.
  unit_cost INT NOT NULL DEFAULT 0,
  note VARCHAR(255) NULL,
  produced_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  user_id INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_stock_semi_item_productions_item (semi_item_id, produced_at),
  CONSTRAINT fk_stock_semi_item_productions_semi_item
    FOREIGN KEY (semi_item_id) REFERENCES stock_semi_items(id)
    ON DELETE SET NULL,
  CONSTRAINT fk_stock_semi_item_productions_user
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE SET NULL
);

-- Bahan baku a cooking used, frozen at that time's unit cost.
CREATE TABLE IF NOT EXISTS stock_semi_item_production_items (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  production_id INT UNSIGNED NOT NULL,
  stock_item_id INT UNSIGNED NULL,
  item_name VARCHAR(150) NOT NULL,
  quantity DOUBLE NOT NULL,
  unit VARCHAR(30) NOT NULL,
  unit_cost INT NOT NULL DEFAULT 0,
  cost DECIMAL(14,2) NOT NULL DEFAULT 0,
  INDEX idx_stock_semi_item_production_items_stock_item (stock_item_id),
  CONSTRAINT fk_stock_semi_item_production_items_production
    FOREIGN KEY (production_id) REFERENCES stock_semi_item_productions(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_stock_semi_item_production_items_stock_item
    FOREIGN KEY (stock_item_id) REFERENCES stock_raw_items(id)
    ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS meta_data_platform (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  icon_url VARCHAR(255),
  tax DECIMAL(12,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT INTO meta_data_platform (name, icon_url, tax) VALUES
    ('GoFood', '/platforms/gofood.png', 0),
    ('GrabFood', '/platforms/grabfood.png', 0),
    ('ShopeeFood', '/platforms/shopeefood.png', 0)
  ON DUPLICATE KEY UPDATE
  icon_url = VALUES(icon_url),
  tax = VALUES(tax);

INSERT INTO categories (name, icon) VALUES
  ('Coffee', '☕'),
  ('Non-Coffee', '🥤'),
  ('Main Course', '🍚'),
  ('Snack', '🍟'),
  ('Catering', '🍱'),
  ('Add Ons', '➕')
ON DUPLICATE KEY UPDATE
  icon = COALESCE(NULLIF(icon, ''), VALUES(icon));

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
WHERE sort_order = 0;

CREATE TABLE IF NOT EXISTS orders (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_code VARCHAR(40) UNIQUE,
  customer_name VARCHAR(100) NOT NULL,
  customer_phone VARCHAR(50) NULL,
  order_type VARCHAR(50) NOT NULL DEFAULT 'Offline',
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
);

CREATE TABLE IF NOT EXISTS order_platforms (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_id INT UNSIGNED NOT NULL UNIQUE,
  meta_data_platform_id INT UNSIGNED NULL,
  platform_name VARCHAR(100) NOT NULL,
  platform_tax DECIMAL(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_order_platforms_meta_data_platform_id (meta_data_platform_id),
  CONSTRAINT fk_order_platforms_order
    FOREIGN KEY (order_id) REFERENCES orders(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_order_platforms_meta_data_platform
    FOREIGN KEY (meta_data_platform_id) REFERENCES meta_data_platform(id)
    ON DELETE SET NULL
);

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
);

CREATE TABLE IF NOT EXISTS order_items (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_id INT UNSIGNED NOT NULL,
  item_key VARCHAR(100),
  menu_item_id INT UNSIGNED NULL,
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
);

-- Per-ingredient HPP of each order item, frozen at sale time: cost =
-- quantity x unit_cost per portion, and the costs sum to order_items.hpp_cost. Later recipe or price changes
-- never touch it; names and units are copied so history stays readable.
CREATE TABLE IF NOT EXISTS order_item_costs (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_item_id INT UNSIGNED NOT NULL,
  -- The bahan baku or bahan setengah jadi sold (NULL once deleted).
  stock_item_id INT UNSIGNED NULL,
  semi_item_id INT UNSIGNED NULL,
  stock_item_name VARCHAR(150) NOT NULL,
  quantity DOUBLE NOT NULL DEFAULT 0,
  unit VARCHAR(30) NOT NULL DEFAULT '',
  unit_cost INT NOT NULL DEFAULT 0,
  cost INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_order_item_costs_order_item_id (order_item_id),
  INDEX idx_order_item_costs_stock_item_id (stock_item_id),
  INDEX idx_order_item_costs_semi_item_id (semi_item_id),
  CONSTRAINT fk_order_item_costs_order_item
    FOREIGN KEY (order_item_id) REFERENCES order_items(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_order_item_costs_stock_item
    FOREIGN KEY (stock_item_id) REFERENCES stock_raw_items(id)
    ON DELETE SET NULL,
  CONSTRAINT fk_order_item_costs_semi_item
    FOREIGN KEY (semi_item_id) REFERENCES stock_semi_items(id)
    ON DELETE SET NULL
);

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
);

INSERT INTO meta_data_format_recap
  (code, label, description, is_active, sort_order)
VALUES
  ('daily', 'Harian', 'Rekap operasional harian', TRUE, 1),
  ('weekly', 'Mingguan', 'Rekap operasional mingguan', TRUE, 2),
  ('monthly', 'Bulanan', 'Rekap operasional bulanan', TRUE, 3)
ON DUPLICATE KEY UPDATE
  label = VALUES(label),
  description = VALUES(description),
  is_active = VALUES(is_active),
  sort_order = VALUES(sort_order);

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
);

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
);

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
);
