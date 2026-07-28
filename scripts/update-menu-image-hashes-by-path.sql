UPDATE menu_items
SET image_path = CASE image_path
  WHEN '/uploads/menu/addon-air-mineral.jpg' THEN '/uploads/menu/addon-air-mineral-4dab72aab0.jpg'
  WHEN '/uploads/menu/addon-buah.jpg' THEN '/uploads/menu/addon-buah-9c87ebb944.jpg'
  WHEN '/uploads/menu/addon-kerupuk.jpg' THEN '/uploads/menu/addon-kerupuk-faaf6f2c8f.jpg'
  WHEN '/uploads/menu/addon-nasi-putih.jpg' THEN '/uploads/menu/addon-nasi-putih-02e8184074.jpg'
  WHEN '/uploads/menu/addon-sambal.jpg' THEN '/uploads/menu/addon-sambal-17d98fec6b.jpg'
  WHEN '/uploads/menu/addon-telur.jpg' THEN '/uploads/menu/addon-telur-25fe043ebb.jpg'
  WHEN '/uploads/menu/americano.jpg' THEN '/uploads/menu/americano-a7098299e6.jpg'
  WHEN '/uploads/menu/aren-latte.jpg' THEN '/uploads/menu/aren-latte-9daa0860f4.jpg'
  WHEN '/uploads/menu/ayam-geprek-rice-bowl.jpg' THEN '/uploads/menu/ayam-geprek-rice-bowl-1ad15279c3.jpg'
  WHEN '/uploads/menu/beef-teriyaki-rice-bowl.jpg' THEN '/uploads/menu/beef-teriyaki-rice-bowl-bd0d2dccf0.jpg'
  WHEN '/uploads/menu/berry-coffee-milk.jpg' THEN '/uploads/menu/berry-coffee-milk-d7f69b0093.jpg'
  WHEN '/uploads/menu/berry-summer.jpg' THEN '/uploads/menu/berry-summer-27a7222ae3.jpg'
  WHEN '/uploads/menu/butterscotch-latte.jpg' THEN '/uploads/menu/butterscotch-latte-3e444ae99e.jpg'
  WHEN '/uploads/menu/cafe-latte.jpg' THEN '/uploads/menu/cafe-latte-1acbe6600b.jpg'
  WHEN '/uploads/menu/cappuccino.jpg' THEN '/uploads/menu/cappuccino-d2eb185afd.jpg'
  WHEN '/uploads/menu/caramel-latte.jpg' THEN '/uploads/menu/caramel-latte-e6dd7de691.jpg'
  WHEN '/uploads/menu/catering-paket-20k.jpg' THEN '/uploads/menu/catering-paket-20k-e91f9d8973.jpg'
  WHEN '/uploads/menu/catering-paket-28k.jpg' THEN '/uploads/menu/catering-paket-28k-296bcf3058.jpg'
  WHEN '/uploads/menu/catering-paket-30k.jpg' THEN '/uploads/menu/catering-paket-30k-a602b24c5e.jpg'
  WHEN '/uploads/menu/catering-paket-35k.jpg' THEN '/uploads/menu/catering-paket-35k-5bac09525e.jpg'
  WHEN '/uploads/menu/catering-paket-40k.jpg' THEN '/uploads/menu/catering-paket-40k-daa33e5477.jpg'
  WHEN '/uploads/menu/chicken-katsu-rice-bowl.jpg' THEN '/uploads/menu/chicken-katsu-rice-bowl-9f77c07d83.jpg'
  WHEN '/uploads/menu/chicken-teriyaki-rice-bowl.jpg' THEN '/uploads/menu/chicken-teriyaki-rice-bowl-de9b95075d.jpg'
  WHEN '/uploads/menu/chocolate.jpg' THEN '/uploads/menu/chocolate-317bab573b.jpg'
  WHEN '/uploads/menu/cireng.jpg' THEN '/uploads/menu/cireng-45396e6a79.jpg'
  WHEN '/uploads/menu/cookies-and-cream.jpg' THEN '/uploads/menu/cookies-and-cream-4ba3428963.jpg'
  WHEN '/uploads/menu/elberry-americano.jpg' THEN '/uploads/menu/elberry-americano-c30281ce32.jpg'
  WHEN '/uploads/menu/fried-egg-rice-bowl.jpg' THEN '/uploads/menu/fried-egg-rice-bowl-71e4a6b35b.jpg'
  WHEN '/uploads/menu/hazelnut-latte.jpg' THEN '/uploads/menu/hazelnut-latte-6f30e26336.jpg'
  WHEN '/uploads/menu/indomie-goreng-telur.jpg' THEN '/uploads/menu/indomie-goreng-telur-908692a040.jpg'
  WHEN '/uploads/menu/indomie-rebus-telur.jpg' THEN '/uploads/menu/indomie-rebus-telur-5bb08c107c.jpg'
  WHEN '/uploads/menu/jeruk-nipis-songkit.jpg' THEN '/uploads/menu/jeruk-nipis-songkit-dd4a1bded6.jpg'
  WHEN '/uploads/menu/kentang-goreng.jpg' THEN '/uploads/menu/kentang-goreng-1bbb3108c0.jpg'
  WHEN '/uploads/menu/latte.jpg' THEN '/uploads/menu/latte-1acbe6600b.jpg'
  WHEN '/uploads/menu/lemon-tea.jpg' THEN '/uploads/menu/lemon-tea-6a2e7161fe.jpg'
  WHEN '/uploads/menu/longblack.jpg' THEN '/uploads/menu/longblack-c9fca6adf7.jpg'
  WHEN '/uploads/menu/lychee-tea.jpg' THEN '/uploads/menu/lychee-tea-b961e917f7.jpg'
  WHEN '/uploads/menu/matcha.jpg' THEN '/uploads/menu/matcha-05d3506b73.jpg'
  WHEN '/uploads/menu/mix-platter.jpg' THEN '/uploads/menu/mix-platter-f9eb1d5ba5.jpg'
  WHEN '/uploads/menu/moccacino.jpg' THEN '/uploads/menu/moccacino-16b683cb90.jpg'
  WHEN '/uploads/menu/on-the-rock-espresso.jpg' THEN '/uploads/menu/on-the-rock-espresso-1159307ad6.jpg'
  WHEN '/uploads/menu/pisang-nugget-keju-coklat.jpg' THEN '/uploads/menu/pisang-nugget-keju-coklat-e321243831.jpg'
  WHEN '/uploads/menu/roti-bakar.jpg' THEN '/uploads/menu/roti-bakar-149c6fcfa6.jpg'
  WHEN '/uploads/menu/thai-tea.jpg' THEN '/uploads/menu/thai-tea-6793cc6d8d.jpg'
  WHEN '/uploads/menu/tropical-americano.jpg' THEN '/uploads/menu/tropical-americano-911a87baf1.jpg'
  WHEN '/uploads/menu/vanilla-latte.jpg' THEN '/uploads/menu/vanilla-latte-8231e75eae.jpg'
  ELSE image_path
END
WHERE image_path IN (
  '/uploads/menu/addon-air-mineral.jpg',
  '/uploads/menu/addon-buah.jpg',
  '/uploads/menu/addon-kerupuk.jpg',
  '/uploads/menu/addon-nasi-putih.jpg',
  '/uploads/menu/addon-sambal.jpg',
  '/uploads/menu/addon-telur.jpg',
  '/uploads/menu/americano.jpg',
  '/uploads/menu/aren-latte.jpg',
  '/uploads/menu/ayam-geprek-rice-bowl.jpg',
  '/uploads/menu/beef-teriyaki-rice-bowl.jpg',
  '/uploads/menu/berry-coffee-milk.jpg',
  '/uploads/menu/berry-summer.jpg',
  '/uploads/menu/butterscotch-latte.jpg',
  '/uploads/menu/cafe-latte.jpg',
  '/uploads/menu/cappuccino.jpg',
  '/uploads/menu/caramel-latte.jpg',
  '/uploads/menu/catering-paket-20k.jpg',
  '/uploads/menu/catering-paket-28k.jpg',
  '/uploads/menu/catering-paket-30k.jpg',
  '/uploads/menu/catering-paket-35k.jpg',
  '/uploads/menu/catering-paket-40k.jpg',
  '/uploads/menu/chicken-katsu-rice-bowl.jpg',
  '/uploads/menu/chicken-teriyaki-rice-bowl.jpg',
  '/uploads/menu/chocolate.jpg',
  '/uploads/menu/cireng.jpg',
  '/uploads/menu/cookies-and-cream.jpg',
  '/uploads/menu/elberry-americano.jpg',
  '/uploads/menu/fried-egg-rice-bowl.jpg',
  '/uploads/menu/hazelnut-latte.jpg',
  '/uploads/menu/indomie-goreng-telur.jpg',
  '/uploads/menu/indomie-rebus-telur.jpg',
  '/uploads/menu/jeruk-nipis-songkit.jpg',
  '/uploads/menu/kentang-goreng.jpg',
  '/uploads/menu/latte.jpg',
  '/uploads/menu/lemon-tea.jpg',
  '/uploads/menu/longblack.jpg',
  '/uploads/menu/lychee-tea.jpg',
  '/uploads/menu/matcha.jpg',
  '/uploads/menu/mix-platter.jpg',
  '/uploads/menu/moccacino.jpg',
  '/uploads/menu/on-the-rock-espresso.jpg',
  '/uploads/menu/pisang-nugget-keju-coklat.jpg',
  '/uploads/menu/roti-bakar.jpg',
  '/uploads/menu/thai-tea.jpg',
  '/uploads/menu/tropical-americano.jpg',
  '/uploads/menu/vanilla-latte.jpg'
);
