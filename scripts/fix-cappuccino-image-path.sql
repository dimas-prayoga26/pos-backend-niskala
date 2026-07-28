UPDATE menu_items
SET image_path = '/uploads/menu/cappuccino-d2eb185afd.jpg'
WHERE name IN ('Cappuccino', 'Cappuccino (R)')
   OR image_path = '/uploads/menu/cappuccino.jpg';

SELECT id, name, image_path
FROM menu_items
WHERE name LIKE '%Cappuccino%'
   OR image_path LIKE '%cappuccino%';
