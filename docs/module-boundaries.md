# Batas Modul

Setiap modul di `src/modules/<nama>/` memiliki tabelnya sendiri. Modul lain boleh **membaca** tabel tersebut lewat SQL join bila diperlukan, tetapi **menulis** hanya lewat modul pemiliknya. Pengecualian yang masih ada dicatat di bagian akhir.

## Dependensi antarmodul (`require`)

```text
orders ──► stock (stock.movements: potong / kembalikan stok dari resep)
stock, shopping ──► menu (menu.costs: hitung ulang menu_item_recipes.cost dan HPP menu saat unit_cost berubah)
stock, orders ──► menu (menu.recipeLines: baris resep menu dari menu_item_recipes + stock_semi_item_menus)
recaps ──► stock (semi.repository.closeDay: sisa bahan setengah jadi harian dibuang saat rekap harian disimpan)
shopping ──► paymentSources (paymentSource.ledger: saldo keluar belanja dan selisih saat item diubah/dihapus)
shopping ──► stock (supply.repository.SUPPLY_CATEGORIES: kategori barang Lainnya)
shared/middleware/authenticate ──► users (user.service: verifikasi token, ambil user)
infrastructure/bootstrap ──► menu (menu.options: baris harga untuk seed)
```

Tidak ada dependensi sirkular. Modul lain hanya bergantung pada `shared/` dan `infrastructure/`.

## Ringkasan modul

| Modul | Prefix API | Tabel yang dimiliki | Membaca tabel lain | Event realtime |
|---|---|---|---|---|
| users | `/api/user` | `users` | – | – |
| categories | `/api/category` | `categories` | – | `menu:changed` |
| menu | `/api/menu-item` | `menu_items`, `menu_item_prices` (harga, harga online, HPP, gross profit; satu baris per menu), `menu_item_recipes` (pivot menu ↔ bahan baku), VIEW `recipe_details` (resep + nama menu/bahan + average cost + cost, baca-saja); menulis juga `stock_semi_item_menus` (baris bahan setengah jadi di resep menu) | `categories`, `stock_raw_items`, `stock_semi_items` (nama bahan) | `menu:changed` |
| stock | `/api/stock-item` | `stock_raw_items` (bahan baku); `stock_semi_items`, `stock_semi_item_recipes`, `stock_semi_item_productions`, `stock_semi_item_production_items`, `stock_semi_item_menus`, `history_stock_semi_wastes` (bahan setengah jadi, `/api/stock-item/semi`); `stock_supply_items` (perlengkapan, `/api/stock-item/supply`) | `menu_item_recipes` (resep, di `stock.movements`; bahan yang masih dipakai resep tidak bisa dihapus) | `stock:changed` |
| shopping | `/api/shopping` | `suplier`, `history_stock_raw_purchases`, `history_stock_raw_purchase_items`, `history_stock_raw_purchase_item_logs`, `history_stock_raw_purchase_attachments` (bukti nota; file di `storage/purchase-receipts`); `history_stock_supply_purchases`, `history_stock_supply_purchase_items`, `history_stock_supply_purchase_attachments` (belanja perlengkapan, `/api/shopping/supply-purchases`); menulis juga `stock_supply_items` | `meta_data_payment_source` (sumber aktif) | `shopping:changed`, `stock:changed` |
| paymentSources | `/api/payment-source` | `meta_data_payment_source` (saldo), `history_payment_source_mutations` (saldo masuk/keluar) | `users` (nama pencatat) | `shopping:changed` |
| platforms | `/api/order-platform` | `meta_data_platform` | – | `platforms:changed` |
| orders | `/api/order` | `orders`, `order_items`, `order_item_costs` (rincian HPP per bahan, dibekukan saat terjual), `order_platforms`, `order_catering_details` | `menu_items`, `menu_item_prices`, `menu_item_recipes`, `stock_raw_items`, `stock_semi_items` (snapshot HPP), `meta_data_platform` (snapshot fee), `daily_recaps` (kunci closing) | `orders:changed`, `stock:changed` |
| recaps | `/api/recap` | `meta_data_format_recap`, `daily_recaps`, `weekly_recaps`, `monthly_recaps` | `users`, `menu_items` (lookup nama) | `recaps:changed` |

## Detail per modul

### users
- **Isi:** `user.repository` (SQL), `user.service` (register, login/JWT, verifikasi token), `user.controller` (cookie `accessToken`), `user.routes`.
- **Aturan:** role disimpan sebagai `Admin` atau `Cashier`. Token JWT berlaku 1 hari, cookie 30 hari. Hash password hanya dibaca oleh jalur login.

### categories
- **Aturan:** menonaktifkan atau mengaktifkan kategori juga mengubah `is_available` semua menu di dalamnya (dalam satu transaksi). Menghapus kategori ikut menghapus menunya (`ON DELETE CASCADE`).

### menu
- **Isi:**
  - `menu.options`: normalisasi resep dan baris harga (dipakai juga oleh seed);
  - `menu.pricing`: aturan harga, HPP, dan profit;
  - `menu.images`: hapus file gambar yang tidak dipakai lagi;
  - `menu.upload`: multer, jpg/png maksimal 3 MB;
  - `menu.service`: orkestrasi;
  - `menu.repository`: SQL.
- **Aturan:**
  - Resep menu tersimpan di dua tabel dengan satu urutan `sort_order`: bahan baku di `menu_item_recipes`, bahan setengah jadi di `stock_semi_item_menus`. API tetap satu daftar `ingredients` (`stockItemId` atau `semiItemId`).
  - `recipes.cost` = quantity × `stock_raw_items.unit_cost` dan `stock_semi_item_menus.cost` = quantity × `stock_semi_items.unit_cost` (rupiah bulat); `menu_item_prices.hpp_cost` = jumlah cost kedua tabel dan `gross_profit` = harga − HPP. Dihitung ulang oleh `menu.costs` saat resep disimpan, saat belanja/COGS mengubah unit_cost, dan setiap boot. Menu yang resepnya belum punya harga beli memakai HPP manual.
  - Setiap menu punya satu harga (tanpa ukuran dan tanpa varian Hot/Cold). Harga, harga online, HPP, dan gross profit ada di `menu_item_prices`, satu baris per menu.
  - `order_items.variant` hanya berisi label lama (mis. "Reguler / Cold") untuk order sebelum ukuran/varian dihapus.
  - Menu default hanya di-seed sekali saat database baru, sehingga edit dan hapus menu tidak pernah ditimpa saat boot.

### stock
- **Isi:** CRUD bahan baku `stock_raw_items` (`stock.repository`, `stock.controller`), bahan setengah jadi `stock_semi_items` (`semi.repository`, `semi.controller`) dan `stock.movements`.
- **`stock.movements`:** satu-satunya kode yang memotong atau mengembalikan stok berdasarkan resep. Ia menerima *recipe lines* `{ menuItemId, quantity }` dan berjalan di koneksi transaksi pemanggil. Baris `menu_item_recipes` memotong `stock_raw_items`, baris `stock_semi_item_menus` memotong `stock_semi_items`. Takaran resep selalu dalam satuan bahannya, jadi tidak ada konversi satuan; mengganti satuan bahan baku antar satuan yang bisa dikonversi (mis. gr → kg) ikut menyesuaikan takaran resep menu dan komposisi bahan setengah jadi.
- **Status stok:** `HARUS ORDER` (stok ≤ minimum; `HARUS MASAK` untuk bahan setengah jadi), `HAMPIR HABIS` (stok ≤ minimum + maks(1, 20%)), `AMAN`, atau `BEBAS STOK` untuk item unlimited. Tanpa minimum (0) hanya stok ≤ 0 yang `HARUS ORDER`; stok berapa pun di atasnya `AMAN`. Badge menu Stok menghitung bahan baku `HARUS ORDER` + `HAMPIR HABIS`; item Bebas Stok tidak punya Nilai (biaya, bukan aset).
- **Nama** bahan baku dan bahan setengah jadi tidak boleh sama, agar pilihan resep menu tidak ganda.
- **Bahan setengah jadi** (`/api/stock-item/semi`; mis. Nasi dari Beras):
  - Komposisinya untuk 1 resep ada di `stock_semi_item_recipes` dan hanya berisi bahan baku.
  - "Catat Masak" (`POST /semi/:id/productions`) menyimpan satu baris `stock_semi_item_productions` dan bahan baku terpakainya di `stock_semi_item_production_items`.
  - Saat Catat Masak, stok bahan baku dipotong sebanyak resep × komposisi. Bahan setengah jadi bertambah sejumlah porsi: berat hasil ÷ `portion_size`, atau dihitung langsung.
  - `unit_cost` bahan setengah jadi menjadi rata-rata bergerak seperti belanja, dan `yield_quantity` diisi porsi per resep dari masak terakhir.
  - Menu yang memakai bahan setengah jadi memotong porsinya lewat `stock.movements` seperti bahan baku.
  - Bahan setengah jadi tidak bisa dibelanjakan dan tidak punya COGS manual. Hanya catatan masak terakhir yang bisa dibatalkan, selama porsinya masih ada.
  - **Kerugian** (`history_stock_semi_wastes`): porsi yang dibuang beserta nilainya (`stock_value / stock` saat itu). Sumbernya:
    - "Buang" (`POST /semi/:id/wastes`, alasan Basi/Tumpah/Lainnya);
    - "Sesuaikan" ke angka yang lebih kecil (alasan Penyesuaian);
    - Rekap Harian (alasan Sisa akhir hari).
  - Bahan dengan `reset_daily` (mis. Nasi) dimulai dari 0 setiap hari. Saat rekap harian disimpan (`recap.service`, satu transaksi), sisanya dibuang. Porsi dari masak setelah tanggal rekap tetap disimpan, sehingga rekap yang disimpan besok pagi tidak ikut membuang nasi baru.
  - Admin bisa membatalkan catatan buang terakhir per bahan; porsinya kembali ke stok.
  - Sebelum 2026-10-28 (develop saja) bahan ini adalah baris `stock_items` dengan `is_prepared`, dan sempat juga ada kolom `recipes.semi_item_id`; migrasi boot memindahkannya ke tabel di atas dan mengembalikan `menu_item_recipes` ke bentuk aslinya (`semiItemsSchema.js`).

### shopping
- **Isi:** `shopping.validation` (validasi strict, semua error 400), `shopping.service` (transaksi pembelian, dibuat dengan factory `createShoppingService(db)` agar bisa diuji di database lain), controller, dan route.
- **Aturan:** lihat `SHOPPING.md`. Ringkasnya:
  - satu pembelian = satu transaksi;
  - `request_id` mencegah stok tergandakan saat request diulang;
  - average cost dihitung ulang setiap pembelian;
  - semua endpoint tulis khusus admin;
  - belanja dengan `paymentSourceId` mencatat saldo keluar lewat `paymentSource.ledger` di transaksi yang sama;
  - bukti nota (`shopping.attachments`, `shopping.upload`): tipe file dicek dari isinya, file privat di `storage/`.

- **Mesin nota** (`shopping.nota`, `shopping.totals`): simpan/draft/posting, ubah/hapus baris dengan pembagian ulang ongkir-diskon-PPN, daftar draft, dan daftar nota terposting (riwayat Per Nota), dipakai bersama oleh belanja bahan baku (`shopping.service`) dan perlengkapan (`shopping.supply`). Posting hanya untuk admin; draft boleh kasir.
- **Belanja lainnya** (`shopping.supply`, dulu "perlengkapan"; tanpa satuan, kategori Peralatan/Perlengkapan/Promosi/Lain-lain, riwayat per kategori): nota yang sama dari form yang sama, barangnya `stock_supply_items`; tidak pernah menyentuh resep atau HPP. Riwayatnya berbentuk sama dengan riwayat bahan baku agar dashboard memakai tabel yang sama.

### paymentSources
- **Isi:** `paymentSource.ledger` (satu-satunya penulis saldo: `postMutation` di koneksi transaksi pemanggil, `findPurchaseSourceId`), `paymentSource.service` (factory `createPaymentSourceService(db)`: daftar, simpan, catat saldo manual, riwayat mutasi), controller, dan route (semua khusus admin).
- **Aturan:** sumber hanya dinonaktifkan, tidak dihapus. Saldo boleh minus. Mutasi tidak pernah diubah; koreksi dicatat sebagai mutasi baru. Lihat `SHOPPING.md`.

### platforms
- **Aturan:** platform tidak pernah dihapus, hanya dinonaktifkan, karena order lama tetap merujuknya. Fee yang tersimpan berfungsi sebagai nilai default; fee yang dikirim order mengalahkannya (snapshot di `order_platforms`).

### orders
- **Isi:**

  | File | Peran |
  |---|---|
  | `order.service` | Siklus hidup order |
  | `order.repository` | SQL dan mapping JSON |
  | `order.code` | Nomor `YYMM-NNNN` dengan named lock per bulan |
  | `order.recapLock` | Tanggal yang sudah direkap harian tidak bisa diubah |
  | `order.snapshots` | HPP item dan fee platform yang dibekukan saat penjualan |
  | `order.items` | Bentuk item keranjang → recipe lines |
  | `order.validation` | Tanggal order online |
  | `orderPrint.controller` + `thermalPrint.store` | Struk RawBT |

- **Aturan:**
  - Membuat order memotong stok bahan. Error 409 berisi `details.insufficientStock`, kecuali bila `allowNegativeStock` dikirim.
  - Menghapus order mengembalikan stok.
  - Order pada tanggal yang sudah direkap harian bernilai 409.
  - Hanya kasir yang boleh mengubah status order.
- **Endpoint print:** `GET …/thermal-print/:token` sengaja tanpa autentikasi; token acak di URL adalah kredensialnya. Job print hanya tersimpan di memori proses (5 menit).

### recaps
- **Isi:** `recap.payload` (normalisasi body; angka keuangan dikirim dashboard), `recap.service` (rekap harian unik per tanggal, rekap mingguan/bulanan di-upsert per periode, tambah kas), repository, controller, dan route.
- **Aturan:** menyimpan rekap harian "menutup" tanggal tersebut untuk modul orders. Menambah kas hanya untuk admin; `cash_difference` dihitung ulang setiap kali.

## Pengecualian yang masih ada (utang teknis)

1. **Seed dan backfill saat boot** (`infrastructure/database/bootstrap`) menulis ke tabel milik hampir semua modul.
2. **categories → `menu_items.is_available`.** Repository kategori ikut mengubah ketersediaan menu saat status kategori berubah. Kode ini dipertahankan di sana karena harus satu transaksi dengan update kategori.
3. **shopping → `stock_raw_items`.** Pembelian menaikkan stok, mengubah average cost, dan membuat barang baru langsung di `stock_raw_items`, di dalam transaksi pembelian. Pemindahan ke `stock.movements` perlu dilakukan bersamaan dengan perbaikan STK-3 (lihat laporan).
