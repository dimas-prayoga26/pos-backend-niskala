UPDATE menu_items
SET image_path = CASE name
  WHEN 'Cappuccino' THEN '/uploads/menu/cappuccino-d2eb185afd.jpg'
  WHEN 'Cafe Latte' THEN '/uploads/menu/cafe-latte-1acbe6600b.jpg'
  WHEN 'Butterscotch Latte' THEN '/uploads/menu/butterscotch-latte-3e444ae99e.jpg'
  WHEN 'Caramel Latte' THEN '/uploads/menu/caramel-latte-e6dd7de691.jpg'
  WHEN 'Vanilla Latte' THEN '/uploads/menu/vanilla-latte-8231e75eae.jpg'
  WHEN 'Hazelnut Latte' THEN '/uploads/menu/hazelnut-latte-6f30e26336.jpg'
  WHEN 'Aren Latte' THEN '/uploads/menu/aren-latte-9daa0860f4.jpg'
  WHEN 'Moccacino' THEN '/uploads/menu/moccacino-16b683cb90.jpg'
  WHEN 'Berry Coffee Milk' THEN '/uploads/menu/berry-coffee-milk-d7f69b0093.jpg'
  WHEN 'Americano' THEN '/uploads/menu/americano-a7098299e6.jpg'
  WHEN 'Longblack' THEN '/uploads/menu/longblack-c9fca6adf7.jpg'
  WHEN 'On The Rock Espresso' THEN '/uploads/menu/on-the-rock-espresso-1159307ad6.jpg'
  WHEN 'Tropical Americano' THEN '/uploads/menu/tropical-americano-911a87baf1.jpg'
  WHEN 'Elberry Americano' THEN '/uploads/menu/elberry-americano-c30281ce32.jpg'
  WHEN 'Berry Summer' THEN '/uploads/menu/berry-summer-27a7222ae3.jpg'
  WHEN 'Chocolate' THEN '/uploads/menu/chocolate-317bab573b.jpg'
  WHEN 'Matcha' THEN '/uploads/menu/matcha-05d3506b73.jpg'
  WHEN 'Cookies and Cream' THEN '/uploads/menu/cookies-and-cream-4ba3428963.jpg'
  WHEN 'Lychee Tea' THEN '/uploads/menu/lychee-tea-b961e917f7.jpg'
  WHEN 'Lemon Tea' THEN '/uploads/menu/lemon-tea-6a2e7161fe.jpg'
  WHEN 'Jeruk Nipis Songkit' THEN '/uploads/menu/jeruk-nipis-songkit-dd4a1bded6.jpg'
  WHEN 'Thai Tea' THEN '/uploads/menu/thai-tea-6793cc6d8d.jpg'
  WHEN 'Fried Egg Rice Bowl' THEN '/uploads/menu/fried-egg-rice-bowl-71e4a6b35b.jpg'
  WHEN 'Chicken Katsu Rice Bowl' THEN '/uploads/menu/chicken-katsu-rice-bowl-9f77c07d83.jpg'
  WHEN 'Chicken Teriyaki Rice Bowl' THEN '/uploads/menu/chicken-teriyaki-rice-bowl-de9b95075d.jpg'
  WHEN 'Ayam Geprek Rice Bowl' THEN '/uploads/menu/ayam-geprek-rice-bowl-1ad15279c3.jpg'
  WHEN 'Beef Teriyaki Rice Bowl' THEN '/uploads/menu/beef-teriyaki-rice-bowl-bd0d2dccf0.jpg'
  WHEN 'Indomie Goreng Telur' THEN '/uploads/menu/indomie-goreng-telur-908692a040.jpg'
  WHEN 'Indomie Rebus Telur' THEN '/uploads/menu/indomie-rebus-telur-5bb08c107c.jpg'
  WHEN 'Kentang Goreng' THEN '/uploads/menu/kentang-goreng-1bbb3108c0.jpg'
  WHEN 'Mix Platter' THEN '/uploads/menu/mix-platter-f9eb1d5ba5.jpg'
  WHEN 'Cireng' THEN '/uploads/menu/cireng-45396e6a79.jpg'
  WHEN 'Pisang Nugget Keju Coklat' THEN '/uploads/menu/pisang-nugget-keju-coklat-e321243831.jpg'
  WHEN 'Roti Bakar' THEN '/uploads/menu/roti-bakar-149c6fcfa6.jpg'
  WHEN 'Paket 20K / Box' THEN '/uploads/menu/catering-paket-20k-e91f9d8973.jpg'
  WHEN 'Paket 28K / Box' THEN '/uploads/menu/catering-paket-28k-296bcf3058.jpg'
  WHEN 'Paket 30K / Box' THEN '/uploads/menu/catering-paket-30k-a602b24c5e.jpg'
  WHEN 'Paket 35K / Box' THEN '/uploads/menu/catering-paket-35k-5bac09525e.jpg'
  WHEN 'Paket 40K / Box' THEN '/uploads/menu/catering-paket-40k-daa33e5477.jpg'
  WHEN 'Nasi Putih' THEN '/uploads/menu/addon-nasi-putih-02e8184074.jpg'
  WHEN 'Telur' THEN '/uploads/menu/addon-telur-25fe043ebb.jpg'
  WHEN 'Buah' THEN '/uploads/menu/addon-buah-9c87ebb944.jpg'
  WHEN 'Sambal' THEN '/uploads/menu/addon-sambal-17d98fec6b.jpg'
  WHEN 'Kerupuk' THEN '/uploads/menu/addon-kerupuk-faaf6f2c8f.jpg'
  WHEN 'Air Mineral' THEN '/uploads/menu/addon-air-mineral-4dab72aab0.jpg'
  ELSE image_path
END
WHERE name IN (
  'Cappuccino',
  'Cafe Latte',
  'Butterscotch Latte',
  'Caramel Latte',
  'Vanilla Latte',
  'Hazelnut Latte',
  'Aren Latte',
  'Moccacino',
  'Berry Coffee Milk',
  'Americano',
  'Longblack',
  'On The Rock Espresso',
  'Tropical Americano',
  'Elberry Americano',
  'Berry Summer',
  'Chocolate',
  'Matcha',
  'Cookies and Cream',
  'Lychee Tea',
  'Lemon Tea',
  'Jeruk Nipis Songkit',
  'Thai Tea',
  'Fried Egg Rice Bowl',
  'Chicken Katsu Rice Bowl',
  'Chicken Teriyaki Rice Bowl',
  'Ayam Geprek Rice Bowl',
  'Beef Teriyaki Rice Bowl',
  'Indomie Goreng Telur',
  'Indomie Rebus Telur',
  'Kentang Goreng',
  'Mix Platter',
  'Cireng',
  'Pisang Nugget Keju Coklat',
  'Roti Bakar',
  'Paket 20K / Box',
  'Paket 28K / Box',
  'Paket 30K / Box',
  'Paket 35K / Box',
  'Paket 40K / Box',
  'Nasi Putih',
  'Telur',
  'Buah',
  'Sambal',
  'Kerupuk',
  'Air Mineral'
);

UPDATE menu_items
SET image_path = '/uploads/menu/latte-1acbe6600b.jpg'
WHERE image_path = '/uploads/menu/latte.jpg';
