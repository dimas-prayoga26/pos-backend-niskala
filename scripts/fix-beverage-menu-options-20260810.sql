START TRANSACTION;

UPDATE menu_items mi
JOIN categories c ON c.id = mi.category_id
LEFT JOIN (
  SELECT
    menu_item_id,
    MAX(CASE WHEN LOWER(name) IN ('reguler', 'regular') THEN price END) AS regular_price,
    MAX(CASE WHEN LOWER(name) IN ('reguler', 'regular') THEN hpp_cost END) AS regular_hpp_cost,
    MAX(CASE WHEN LOWER(name) IN ('reguler', 'regular') THEN gross_profit END) AS regular_gross_profit
  FROM menu_item_sizes
  GROUP BY menu_item_id
) regular_size ON regular_size.menu_item_id = mi.id
SET
  mi.price = CASE mi.name
    WHEN 'Americano' THEN 15000
    WHEN 'Longblack' THEN 15000
    WHEN 'On The Rock Espresso' THEN 15000
    WHEN 'Cappuccino' THEN 18000
    WHEN 'Cafe Latte' THEN 18000
    WHEN 'Butterscotch Latte' THEN 20000
    WHEN 'Caramel Latte' THEN 20000
    WHEN 'Vanilla Latte' THEN 20000
    WHEN 'Hazelnut Latte' THEN 20000
    WHEN 'Aren Latte' THEN 20000
    WHEN 'Moccacino' THEN 22000
    WHEN 'Berry Coffee Milk' THEN 22000
    WHEN 'Tropical Americano' THEN 23000
    WHEN 'Elberry Americano' THEN 23000
    WHEN 'Berry Summer' THEN 23000
    WHEN 'Chocolate' THEN 18000
    WHEN 'Matcha' THEN 18000
    WHEN 'Cookies and Cream' THEN 18000
    WHEN 'Lychee Tea' THEN 13000
    WHEN 'Lemon Tea' THEN 13000
    WHEN 'Jeruk Nipis Songkit' THEN 13000
    WHEN 'Thai Tea' THEN 15000
    ELSE COALESCE(regular_size.regular_price, mi.price)
  END,
  mi.hpp_cost = COALESCE(regular_size.regular_hpp_cost, mi.hpp_cost, 0),
  mi.gross_profit = COALESCE(regular_size.regular_gross_profit, mi.gross_profit, 0)
WHERE c.name IN ('Coffee', 'Non-Coffee');

DELETE mis
FROM menu_item_sizes mis
JOIN menu_items mi ON mi.id = mis.menu_item_id
JOIN categories c ON c.id = mi.category_id
WHERE c.name IN ('Coffee', 'Non-Coffee');

DELETE mii
FROM menu_item_ingredients mii
JOIN menu_items mi ON mi.id = mii.menu_item_id
JOIN categories c ON c.id = mi.category_id
WHERE c.name IN ('Coffee', 'Non-Coffee')
  AND mii.size_name IS NOT NULL
  AND TRIM(mii.size_name) <> '';

DELETE miv
FROM menu_item_variants miv
JOIN menu_items mi ON mi.id = miv.menu_item_id
JOIN categories c ON c.id = mi.category_id
WHERE c.name IN ('Coffee', 'Non-Coffee');

INSERT INTO menu_item_variants (menu_item_id, name, sort_order)
SELECT mi.id, variant_options.name, variant_options.sort_order
FROM menu_items mi
JOIN categories c ON c.id = mi.category_id
JOIN (
  SELECT 'Cold' AS name, 1 AS sort_order
  UNION ALL
  SELECT 'Hot' AS name, 2 AS sort_order
) variant_options
WHERE c.name IN ('Coffee', 'Non-Coffee')
  AND mi.name NOT IN (
    'On The Rock Espresso',
    'Tropical Americano',
    'Elberry Americano',
    'Berry Summer',
    'Cookies and Cream'
  )
ON DUPLICATE KEY UPDATE
  sort_order = VALUES(sort_order);

COMMIT;
