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
  image_url VARCHAR(255),
  is_available BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_menu_items_category_id (category_id),
  CONSTRAINT fk_menu_items_category
    FOREIGN KEY (category_id) REFERENCES categories(id)
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

