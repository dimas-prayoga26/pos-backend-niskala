-- Revert menu HPP values that were inflated by Auto +30%.
-- Formula:
--   original_hpp = current_hpp / 1.3
--   gross_profit = price - original_hpp
--
-- Safe to run more than once. The migration marker prevents repeated division.

CREATE TABLE IF NOT EXISTS menu_hpp_adjustment_migrations (
  migration_name VARCHAR(120) PRIMARY KEY,
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  note VARCHAR(255) NULL
);

CREATE TABLE IF NOT EXISTS menu_hpp_revert_auto_30_backup (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  migration_name VARCHAR(120) NOT NULL,
  source_table VARCHAR(64) NOT NULL,
  source_id INT UNSIGNED NOT NULL,
  menu_item_id INT UNSIGNED NULL,
  menu_name VARCHAR(150) NOT NULL,
  size_name VARCHAR(80) NULL,
  price_before DECIMAL(12,2) NULL,
  hpp_cost_before DECIMAL(12,2) NULL,
  gross_profit_before DECIMAL(12,2) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_menu_hpp_backup_source (
    migration_name,
    source_table,
    source_id
  )
);

SET @migration_name = 'revert-menu-hpp-auto-30-percent-20261013';
SET @already_applied = (
  SELECT COUNT(*)
  FROM menu_hpp_adjustment_migrations
  WHERE migration_name = @migration_name
);

START TRANSACTION;

INSERT INTO menu_hpp_revert_auto_30_backup (
  migration_name,
  source_table,
  source_id,
  menu_item_id,
  menu_name,
  size_name,
  price_before,
  hpp_cost_before,
  gross_profit_before
)
SELECT
  @migration_name,
  'menu_items',
  mi.id,
  mi.id,
  mi.name,
  NULL,
  mi.regular_price,
  mi.hpp_cost,
  mi.gross_profit
FROM menu_items mi
WHERE @already_applied = 0
  AND mi.hpp_cost IS NOT NULL
  AND mi.hpp_cost > 0;

INSERT INTO menu_hpp_revert_auto_30_backup (
  migration_name,
  source_table,
  source_id,
  menu_item_id,
  menu_name,
  size_name,
  price_before,
  hpp_cost_before,
  gross_profit_before
)
SELECT
  @migration_name,
  'menu_item_sizes',
  mis.id,
  mis.menu_item_id,
  mi.name,
  mis.name,
  mis.price,
  mis.hpp_cost,
  mis.gross_profit
FROM menu_item_sizes mis
JOIN menu_items mi ON mi.id = mis.menu_item_id
WHERE @already_applied = 0
  AND mis.hpp_cost IS NOT NULL
  AND mis.hpp_cost > 0;

UPDATE menu_items mi
JOIN (
  SELECT
    id,
    ROUND(hpp_cost / 1.3, 2) AS new_hpp_cost
  FROM menu_items
  WHERE hpp_cost IS NOT NULL
    AND hpp_cost > 0
) calculated ON calculated.id = mi.id
SET
  mi.hpp_cost = calculated.new_hpp_cost,
  mi.gross_profit = CASE
    WHEN mi.regular_price IS NULL THEN mi.gross_profit
    ELSE ROUND(mi.regular_price - calculated.new_hpp_cost, 2)
  END
WHERE @already_applied = 0
  AND mi.hpp_cost IS NOT NULL
  AND mi.hpp_cost > 0;

UPDATE menu_item_sizes mis
JOIN (
  SELECT
    id,
    ROUND(hpp_cost / 1.3, 2) AS new_hpp_cost
  FROM menu_item_sizes
  WHERE hpp_cost IS NOT NULL
    AND hpp_cost > 0
) calculated ON calculated.id = mis.id
SET
  mis.hpp_cost = calculated.new_hpp_cost,
  mis.gross_profit = ROUND(mis.price - calculated.new_hpp_cost, 2)
WHERE @already_applied = 0
  AND mis.hpp_cost IS NOT NULL
  AND mis.hpp_cost > 0;

INSERT INTO menu_hpp_adjustment_migrations (
  migration_name,
  note
)
SELECT
  @migration_name,
  'Reverted menu_items/menu_item_sizes hpp_cost from Auto +30% using hpp_cost / 1.3'
WHERE @already_applied = 0;

COMMIT;

SELECT
  CASE
    WHEN @already_applied = 0 THEN 'APPLIED'
    ELSE 'SKIPPED_ALREADY_APPLIED'
  END AS status,
  @migration_name AS migration_name;
