# Batas Modul

Setiap modul di `src/modules/<nama>/` memiliki tabelnya sendiri. Modul lain boleh **membaca** tabel tersebut lewat SQL join bila diperlukan, tetapi **menulis** hanya lewat modul pemiliknya. Pengecualian yang masih ada dicatat di bagian akhir.

## Dependensi antarmodul (`require`)

```text
orders ──► stock (stock.movements: potong / kembalikan stok dari resep)
shared/middleware/authenticate ──► users (user.service: verifikasi token, ambil user)
infrastructure/bootstrap ──► menu (menu.options: normalisasi size/varian untuk seed)
```

Tidak ada dependensi sirkular. Modul lain hanya bergantung pada `shared/` dan `infrastructure/`.

## Ringkasan modul

| Modul | Prefix API | Tabel yang dimiliki | Membaca tabel lain | Event realtime |
|---|---|---|---|---|
| users | `/api/user` | `users` | – | – |
| categories | `/api/category` | `categories` | – | `menu:changed` |
| menu | `/api/menu-item` | `menu_items`, `menu_item_sizes`, `menu_item_variants`, `menu_item_ingredients`, `menu_seed_exclusions` | `categories`, `stock_items` (nama bahan) | `menu:changed` |
| stock | `/api/stock-item` | `stock_items` | `menu_item_ingredients` (resep, di `stock.movements`) | `stock:changed` |
| shopping | `/api/shopping` | `suplier`, `stock_purchases`, `stock_purchase_items`, `stock_purchase_item_logs` | – | `shopping:changed`, `stock:changed` |
| platforms | `/api/order-platform` | `meta_data_platform` | – | `platforms:changed` |
| orders | `/api/order` | `orders`, `order_items`, `order_platforms`, `order_catering_details` | `menu_items`, `menu_item_sizes`, `menu_item_ingredients`, `stock_items` (snapshot HPP), `meta_data_platform` (snapshot fee), `daily_recaps` (kunci closing) | `orders:changed`, `stock:changed` |
| recaps | `/api/recap` | `meta_data_format_recap`, `daily_recaps`, `weekly_recaps`, `monthly_recaps` | `users`, `menu_items` (lookup nama) | `recaps:changed` |

## Detail per modul

### users
- **Isi:** `user.repository` (SQL), `user.service` (register, login/JWT, verifikasi token), `user.controller` (cookie `accessToken`), `user.routes`.
- **Aturan:** role disimpan sebagai `Admin` atau `Cashier`. Token JWT berlaku 1 hari, cookie 30 hari. Hash password hanya dibaca oleh jalur login.

### categories
- **Aturan:** menonaktifkan atau mengaktifkan kategori juga mengubah `is_available` semua menu di dalamnya (dalam satu transaksi). Menghapus kategori ikut menghapus menunya (`ON DELETE CASCADE`).

### menu
- **Isi:**
  - `menu.options`: normalisasi size, varian, dan resep (dipakai juga oleh seed);
  - `menu.pricing`: aturan harga, HPP, dan profit;
  - `menu.images`: hapus file gambar yang tidak dipakai lagi;
  - `menu.upload`: multer, jpg/png maksimal 3 MB;
  - `menu.service`: orkestrasi;
  - `menu.repository`: SQL.
- **Aturan:**
  - Menu ber-size menyimpan harga dan HPP per size, sehingga harga dasar dan HPP-nya null.
  - Mengedit atau menghapus menu hasil seed menambahkannya ke `menu_seed_exclusions` agar seed saat boot tidak menimpanya.

### stock
- **Isi:** CRUD `stock_items` (`stock.repository`, `stock.controller`) dan `stock.movements`.
- **`stock.movements`:** satu-satunya kode yang memotong atau mengembalikan stok berdasarkan resep. Ia menerima *recipe lines* `{ menuItemId, sizeName, quantity }` dan berjalan di koneksi transaksi pemanggil. Konversi satuannya lenient (`convertRecipeQuantity`).
- **Status stok:** `HARUS ORDER` (stok ≤ minimum), `HAMPIR HABIS` (stok ≤ minimum + maks(1, 20%)), `AMAN`, atau `BEBAS STOK` untuk item unlimited.

### shopping
- **Isi:** `shopping.validation` (validasi strict, semua error 400), `shopping.service` (transaksi pembelian, dibuat dengan factory `createShoppingService(db)` agar bisa diuji di database lain), controller, dan route.
- **Aturan:** lihat `SHOPPING.md`. Ringkasnya:
  - satu pembelian = satu transaksi;
  - `request_id` mencegah stok tergandakan saat request diulang;
  - average cost dihitung ulang setiap pembelian;
  - semua endpoint tulis khusus admin.

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
3. **shopping → `stock_items`.** Pembelian menaikkan stok, mengubah average cost, dan membuat barang baru langsung di `stock_items`, di dalam transaksi pembelian. Pemindahan ke `stock.movements` perlu dilakukan bersamaan dengan perbaikan STK-3 (lihat laporan).
