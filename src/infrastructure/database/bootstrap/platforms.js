const { pool } = require("../pool");
const { getColumnNames, runSafeMigration } = require("./helpers");
const { seedOrderPlatforms } = require("./seedData");

const createMetaDataPlatformTable = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS meta_data_platform (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL UNIQUE,
      icon_url VARCHAR(255),
      tax DECIMAL(12,2) NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
  await runSafeMigration("ALTER TABLE meta_data_platform ADD COLUMN icon_url VARCHAR(255) NULL AFTER name");
  await runSafeMigration("ALTER TABLE meta_data_platform ADD COLUMN tax DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER icon_url");
  await runSafeMigration("ALTER TABLE meta_data_platform MODIFY COLUMN tax DECIMAL(12,2) NOT NULL DEFAULT 0");
  await runSafeMigration("ALTER TABLE meta_data_platform ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE AFTER tax");
};

const migrateLegacyOrderPlatformMaster = async () => {
  const columnNames = await getColumnNames("order_platforms");

  if (!columnNames.size || columnNames.has("order_id")) return;

  const legacyIconColumn = columnNames.has("icon_url") ? "icon_url" : "NULL";
  const legacyTaxColumn = columnNames.has("tax") ? "tax" : "0";
  const legacyActiveColumn = columnNames.has("is_active") ? "is_active" : "TRUE";

  await pool.query(`
    INSERT INTO meta_data_platform (name, icon_url, tax, is_active)
    SELECT name, ${legacyIconColumn}, COALESCE(${legacyTaxColumn}, 0), ${legacyActiveColumn}
    FROM order_platforms
    WHERE name IS NOT NULL AND name <> ''
    ON DUPLICATE KEY UPDATE
      icon_url = COALESCE(NULLIF(VALUES(icon_url), ''), meta_data_platform.icon_url),
      tax = VALUES(tax),
      is_active = VALUES(is_active)
  `);
  await pool.query("DROP TABLE order_platforms");
};

const seedMetaDataPlatforms = async () => {
  await pool.query(
    `INSERT INTO meta_data_platform (name, icon_url, tax)
     VALUES ?
     ON DUPLICATE KEY UPDATE
       icon_url = VALUES(icon_url)`,
    [seedOrderPlatforms]
  );
  await runSafeMigration("DELETE FROM meta_data_platform WHERE name = 'Maxim Food'");
};

const createOrderPlatformRelationTable = async () => {
  await pool.query(`
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
    )
  `);
  await runSafeMigration("ALTER TABLE order_platforms ADD COLUMN meta_data_platform_id INT UNSIGNED NULL AFTER order_id");
  await runSafeMigration("ALTER TABLE order_platforms ADD COLUMN platform_name VARCHAR(100) NOT NULL AFTER meta_data_platform_id");
  await runSafeMigration("ALTER TABLE order_platforms ADD COLUMN platform_tax DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER platform_name");
  await runSafeMigration("ALTER TABLE order_platforms MODIFY COLUMN platform_tax DECIMAL(12,2) NOT NULL DEFAULT 0");
  await runSafeMigration("CREATE INDEX idx_order_platforms_meta_data_platform_id ON order_platforms (meta_data_platform_id)");
  await runSafeMigration("ALTER TABLE order_platforms ADD CONSTRAINT fk_order_platforms_meta_data_platform FOREIGN KEY (meta_data_platform_id) REFERENCES meta_data_platform(id) ON DELETE SET NULL");
};

const backfillOrderPlatformRelations = async () => {
  const orderColumnNames = await getColumnNames("orders");

  if (!orderColumnNames.has("order_platform")) return;

  await pool.query(`
    INSERT IGNORE INTO order_platforms
      (order_id, meta_data_platform_id, platform_name, platform_tax)
    SELECT
      o.id,
      mdp.id,
      o.order_platform,
      COALESCE(mdp.tax, 0)
    FROM orders o
    LEFT JOIN meta_data_platform mdp ON LOWER(mdp.name) = LOWER(o.order_platform)
    WHERE o.order_type = 'Online'
      AND o.order_platform IS NOT NULL
      AND o.order_platform <> ''
  `);
};

module.exports = {
  backfillOrderPlatformRelations,
  createMetaDataPlatformTable,
  createOrderPlatformRelationTable,
  migrateLegacyOrderPlatformMaster,
  seedMetaDataPlatforms,
};
