# Arsitektur Backend POS

Backend memakai pola **modular monolith**: satu proses Node.js (Express 4 + mysql2 + Socket.IO), satu database MySQL, dan kode yang dibagi per domain bisnis di `src/modules/`. Setiap modul memiliki route, controller, dan repository sendiri. Service hanya ada di modul yang memang punya aturan bisnis.

## Struktur direktori

```text
app.js                         Entry point proses (juga startup file Passenger)
src/
├── server.js                  Membuat app, memasang Socket.IO, menjalankan bootstrap DB, lalu listen
├── app.js                     createApp(): CORS, parser, static /uploads, mount route, error handler
├── config/
│   ├── env.js                 Konfigurasi dari .env (port, DB, JWT, CORS, timezone)
│   ├── cors.js                Origin yang diizinkan (Vite lokal/LAN + CORS_ORIGINS)
│   └── paths.js               Lokasi folder uploads
├── infrastructure/
│   ├── database/
│   │   ├── pool.js            Pool mysql2 + withTransaction()
│   │   └── bootstrap/         Manajemen skema saat startup (lihat bawah)
│   └── realtime/socket.js     Socket.IO + emitRealtimeEvent()
├── shared/
│   ├── http/asyncHandler.js   Meneruskan error async ke error handler
│   ├── middleware/            authenticate, authorize (requireRole), validateParams, errorHandler
│   ├── utils/                 money, units, orderCode, dbErrors, networkAddresses
│   └── logger.js              Log terstruktur (JSON per baris)
└── modules/
    ├── users/        /api/user
    ├── categories/   /api/category
    ├── menu/         /api/menu-item
    ├── stock/        /api/stock-item  (+ stock.movements untuk mutasi stok dari order)
    ├── shopping/     /api/shopping
    ├── platforms/    /api/order-platform
    ├── orders/       /api/order       (+ cetak thermal RawBT)
    └── recaps/       /api/recap
tests/
├── unit/             Fungsi murni (node:test), tanpa database
├── integration/      Tes dengan database sementara (shopping, regresi)
├── characterization/ Golden master seluruh API (lihat "Pengujian")
└── helpers/          Menjalankan app.js terhadap database sementara
```

## Alur request

```text
route ──► authenticate ──► requireRole / requireNumericId ──► controller ──► service ──► repository ──► MySQL
                                                                  │
                                                                  └──► emitRealtimeEvent() ──► Socket.IO (semua klien)
```

| Lapisan | Tanggung jawab | Tidak boleh |
|---|---|---|
| **route** (`*.routes.js`) | Path, method, dan urutan guard (auth, role, validasi id) | Berisi logika |
| **controller** (`*.controller.js`) | Membaca request, memanggil service/repository, memilih status code, mengirim event realtime | Menulis SQL |
| **service** (`*.service.js`) | Aturan bisnis, orkestrasi transaksi, error bisnis (`http-errors`) | Menyentuh `req`/`res` |
| **repository** (`*.repository.js`) | SQL dan pemetaan baris ke JSON (`snake_case` → `camelCase`) | Aturan bisnis |

Modul yang sederhana (categories, platforms, stock CRUD) tidak memiliki service: controller memanggil repository langsung (YAGNI).

### Otorisasi

Role dan validasi id dideklarasikan di route, sehingga hak akses setiap endpoint terbaca di satu tempat:

```js
router.put("/:id", authenticate, adminOnly, requireNumericId(), updateCategory);
router.patch("/:id/stock", authenticate, requireNumericId(), staffOnly, updateStockQuantity);
```

Urutan guard sengaja dibuat berbeda per endpoint. Urutan ini meniru kode lama supaya status code untuk input yang tidak valid tetap sama (misalnya `/:id/stock` memeriksa id sebelum role).

## Startup dan skema database

`src/server.js` menjalankan `bootstrapDatabase()` sebelum `listen`. Fungsi ini menjalankan `connectDB()` (`infrastructure/database/bootstrap/index.js`) lalu `ensureShoppingSchema()`. Pada **setiap** start, keduanya:

1. membuat database dan tabel bila belum ada;
2. menjalankan ALTER/DROP/UPDATE lewat `runSafeMigration()`, yang menelan semua error agar idempoten;
3. menjalankan seed katalog default (`bootstrap/seedData.js`): kategori, stok, platform, dan format rekap. Menu default (harga dan resep) hanya di-seed saat tabel `menu_items` baru dibuat, jadi menu yang diedit atau dihapus admin tidak pernah ditimpa;
4. menjalankan backfill (kode order bulanan, relasi platform, HPP item order).

Isi `config/database.js` lama sudah dipecah tanpa mengubah urutan statement:

| File | Isi |
|---|---|
| `bootstrap/index.js` | Urutan migrasi `connectDB()` |
| `bootstrap/seedData.js` | Data katalog default |
| `bootstrap/menuCatalog.js` | Migrasi data menu lama (opsi, harga, resep), seed menu default untuk database baru |
| `bootstrap/platforms.js` | Tabel platform dan relasi order–platform |
| `bootstrap/orderCodes.js` | Backfill kode `YYMM-NNNN` |
| `bootstrap/shoppingSchema.js` | Tabel belanja dan supplier |
| `bootstrap/helpers.js` | `runSafeMigration`, `tableExists`, `getColumnNames` |

**Keputusan:** mekanisme migrasi saat runtime dipertahankan. Mengganti ke migrasi berversi membutuhkan dump skema production terlebih dahulu, karena `runSafeMigration` mungkin pernah gagal diam-diam di sana. Rekomendasinya ada di `refactoring-report.md`.

`database/schema.sql` hanya referensi. Setiap perubahan skema harus ditulis di `bootstrap/` **dan** `schema.sql`.

## Transaksi

- `withTransaction(fn)` di `pool.js` dipakai untuk transaksi sederhana (kategori, menu, kas rekap).
- `order.service.create` mengelola transaksinya sendiri, karena *named lock* nomor order (`GET_LOCK`) harus dilepas **setelah** commit agar order berikutnya melihat kode yang baru.
- Mutasi stok dari order (`stock/stock.movements.js`) selalu berjalan di koneksi transaksi milik pemanggil.

## Realtime

Setiap mutasi memanggil `emitRealtimeEvent(event, payload)`. Event yang dipakai: `orders:changed`, `stock:changed`, `menu:changed`, `platforms:changed`, `recaps:changed`, `shopping:changed`. Frontend (`useRealtimeData.js`) menerjemahkannya menjadi invalidasi cache React Query. Endpoint baru yang mengubah data wajib mengirim event yang sesuai.

## Error dan logging

- Error dibuat dengan `http-errors` (`createHttpError(status, message, { details })`) dan diteruskan ke `shared/middleware/errorHandler.js`.
- Format response error adalah kontrak API: `{ status, message, errorStack, details? }`. `errorStack` hanya terisi saat `NODE_ENV=development`. Frontend membaca `message` dan `details.insufficientStock`.
- Error 5xx dicatat lewat `shared/logger.js` sebagai JSON per baris (dikumpulkan Passenger dari stdout/stderr).

## Pengujian

| Perintah | Isi |
|---|---|
| `npm run lint` | ESLint 8 (flat config, kompatibel dengan Node 18.8) |
| `npm run test:unit` | Fungsi murni: harga menu, payload rekap, konversi satuan, guard, thermal store |
| `npm run test:integration` | Transaksi belanja + tes regresi bug |
| `npm run test:characterization` | Golden master seluruh API |
| `npm test` | Ketiganya |

Tes karakterisasi menjalankan `app.js` terhadap database `pos_characterization_test`, lalu menjalankan 177 langkah yang mencakup setiap endpoint, role, dan cabang error. Yang direkam: status, header kontrak, body, event socket, isi seluruh tabel, dan isi tabel setelah server di-restart. Hasilnya dibandingkan dengan `tests/characterization/__snapshots__/baseline.json`.

Perbarui baseline (`npm run test:characterization:update`) **hanya** untuk perubahan perilaku yang disengaja, dan catat alasannya di laporan refactor.

Semua tes memakai database bernama `pos_*test*`. Helper menolak nama lain, jadi `pos_system` tidak pernah tersentuh.

## Keputusan arsitektur

| Keputusan | Alasan |
|---|---|
| Tetap JavaScript (CommonJS), tidak migrasi ke TypeScript | Tujuan refactor adalah struktur tanpa perubahan perilaku; migrasi bahasa adalah proyek terpisah |
| Tanpa container DI | Modul cukup memakai `require`; repository yang perlu diuji dengan DB lain menerima `db` (pola `createShoppingService(db)`) |
| Service hanya di modul berlogika | Menghindari lapisan kosong yang hanya meneruskan panggilan |
| Mutasi stok dari order ada di modul stock | Hanya modul stock yang mengubah `stock_items` dari resep; orders memanggil API-nya |
| Kontrak response tidak diubah (termasuk alias `_id`/`id` dan envelope yang tidak seragam) | Frontend dan aplikasi RawBT bergantung padanya |
| Konversi satuan dibuat dua varian (`convertRecipeQuantity` lenient, `convertQuantity` strict di shopping) | Semantik keduanya memang berbeda di kode lama. Resep kini tidak punya satuan sendiri; `convertRecipeQuantity` hanya dipakai migrasi boot untuk memindahkan takaran lama ke satuan stok |
