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
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

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
);

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
);

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
);

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
);

CREATE TABLE IF NOT EXISTS order_platforms (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  icon_url VARCHAR(255),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT INTO order_platforms (name, icon_url) VALUES
    ('GoFood', '/platforms/gofood.png'),
    ('GrabFood', '/platforms/grabfood.png'),
    ('ShopeeFood', '/platforms/shopeefood.png')
  ON DUPLICATE KEY UPDATE
  icon_url = VALUES(icon_url);

INSERT INTO categories (name, icon) VALUES
  ('Coffee', '☕'),
  ('Non-Coffee', '🥤'),
  ('Main Course', '🍚'),
  ('Snack', '🍟'),
  ('Catering', '🍱'),
  ('Add Ons', '➕')
ON DUPLICATE KEY UPDATE
  icon = VALUES(icon),
  is_active = TRUE;

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
);

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
);

CREATE TABLE IF NOT EXISTS add_ons (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(80) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  price DECIMAL(12,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

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
);

INSERT INTO add_ons (code, name, price) VALUES
  ('nasi-putih', 'Nasi Putih', 4000),
  ('telur', 'Telur', 5000),
  ('buah', 'Buah', 5000),
  ('sambal', 'Sambal', 4000),
  ('kerupuk', 'Kerupuk', 3000),
  ('air-mineral', 'Air Mineral', 5000)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  price = VALUES(price),
  is_active = TRUE;

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

