# Laporan Audit & Refactoring Backend

- **Tanggal:** 13 Oktober 2026
- **Branch:** `refactor/modular-architecture` (repo `pos-backend`)
- **Snapshot WIP sebelum refactor:** `stash@{0}` ("user WIP: remove payments/midtrans"). Gunakan `git diff stash@{0}` untuk melihat perubahan refactor saja, terpisah dari penghapusan fitur pembayaran.

## 1. Ringkasan

- Backend sudah direstrukturisasi dari pola *route → controller → model* per jenis file menjadi **modular monolith per domain** (`src/modules/*`).
- Seluruh 177 skenario API, isi 21 tabel, dan efek restart server **identik** dengan perilaku sebelum refactor. Ini dibuktikan oleh tes karakterisasi yang direkam dari kode lama sebelum perubahan apa pun.
- Setelah refactor, **5 bug** yang aman diperbaiki. Masing-masing punya tes regresi yang terbukti gagal di kode lama.
- Sejumlah masalah lain menyangkut aturan bisnis atau hak akses, sehingga **membutuhkan keputusan pemilik** (bagian 6).

## 2. Kondisi awal (hasil audit)

**Stack:** Node 18.8, Express 4, mysql2 dengan SQL manual, JWT dalam cookie, Socket.IO, multer; CommonJS tanpa TypeScript. Kode sekitar 5.800 baris, tanpa test runner, tanpa linter.

**Masalah struktur:**

| Masalah | Rincian |
|---|---|
| `config/database.js` 1.547 baris | Pool, migrasi saat startup (sekitar 110 `runSafeMigration` yang menelan error), seed katalog, dan backfill data bercampur di satu file |
| `models/orderModel.js` 964 baris | Persistensi, nomor order, potong/kembalikan stok, snapshot HPP, kunci rekap, dan mapping JSON dalam satu file |
| Modul shopping tidak konsisten | Tanpa controller: handler inline di route, guard admin dan wrapper async sendiri |
| Otorisasi tersebar | `requireAdmin` disalin di 4 controller; cek role inline di sekitar 15 tempat dengan pesan berbeda |
| Error tidak seragam | Empat mekanisme: `createHttpError`, `new Error` + `statusCode`, `http-errors` di model, error dari store |
| Helper duplikat | `roundCurrency` ×3, `parseNominal` ×2, `parseNumber` ×2, format kode order ×2, normalisasi size/varian ×2, tabel satuan ×2 (dengan semantik berbeda), boilerplate transaksi ×9 |
| Kode mati | `updateCateringPaymentAmount`, beberapa export `findById`, `mapUser`, `normalizePurchase`, `defaultCategories`, dependensi npm `crypto` (stub; yang dipakai modul bawaan Node), `"main": "index.js"` yang tidak ada |
| Lain-lain | Tidak ada logging terstruktur |

**Metode audit:**
1. 8 auditor paralel per domain/aspek: bootstrap-DB, auth & keamanan, orders, menu, stok & belanja, rekap & platform, kontrak API dari sisi frontend, lintas-modul.
2. Setiap temuan diverifikasi ulang oleh *skeptic* independen.
3. Satu *completeness critic* mencari celah yang belum diperiksa.

**Hasil:** 218 temuan terverifikasi (6 critical, 29 high, 84 medium, 99 low). Banyak yang sama karena ditemukan oleh beberapa auditor; tabel di bawah sudah digabungkan.

## 3. Masalah berdasarkan prioritas

**Status:**
- ✅ **Diperbaiki:** bug fix dengan tes.
- 🧱 **Refactor:** diselesaikan oleh restrukturisasi.
- ⚖️ **Keputusan:** butuh persetujuan pemilik.
- 📋 **Backlog:** belum dikerjakan.

### Critical / High

| ID (gabungan) | Masalah | Status |
|---|---|---|
| STK-1 / BOOT-1 | Setiap restart menonaktifkan **semua** barang stok yang tidak ada di daftar seed, termasuk barang buatan admin dan hasil belanja. Barang tersebut hilang dari daftar stok, dan pembelian ulang dengan nama yang sama ditolak 409 | ✅ F1 |
| BOOT-6 | Backfill kode order memakai key counter yang salah, menghasilkan kode duplikat sehingga **server gagal start** | ✅ F2 |
| AUTH-1 / XC-1 / API-1 | `POST /api/user/register` publik dan bisa memilih role **Admin** | ⚖️ D1 |
| ORD-1 / XC-2 / MENU-02 | Total, pajak, harga item, fee platform, dan DP diterima dari klien apa adanya | ⚖️ D2 |
| REC-1 / REC-2 / XC-6 | Kasir bisa membuat atau menimpa rekap dengan angka dari klien; rekap harian mengunci order pada tanggal itu | ⚖️ D3 |
| BOOT-2 / STK-2 | Seed menimpa unit, kategori, minimum, dan supplier stok seed setiap boot | ⚖️ D4 |
| BOOT-3 | Backfill saat boot mengubah `order_items.hpp_cost` historis | ⚖️ D4 |
| BOOT-5 / MENU-03 / MENU-04 / XC-4 | Kategori seed yang dihapus atau di-rename muncul lagi saat boot; hapus kategori ikut menghapus menunya | ⚖️ D4 |
| BOOT-7 | Migrasi saat runtime tanpa versi, error ditelan | ⚖️ D5 |
| AUTH-2 / BOOT-10 | `JWT_SECRET` tidak divalidasi; `.env.example` berisi secret yang juga dipakai `.env` lokal | 🧱 sebagian: kini ada peringatan saat start; rotasi secret ⚖️ D6 |
| ORD-3 / XC-9 / MENU-06 | Hapus order mengembalikan stok berdasarkan resep dan biaya **saat ini**, bukan yang dulu dipotong | ⚖️ D7 |
| STK-3 | Edit atau hapus item belanja setelah stoknya terpakai bisa membuat `stock_value` dan `average_cost` negatif | ⚖️ D7 |
| MENU-01 / API-9 | Aturan HPP ×1,3 hanya ada di frontend | ⚖️ D2 |
| XC-3 | Menandai catering "belum lunas" tidak berdampak, karena response menghitung status dari nominal | ⚖️ D8 |
| XC-5 | Format rekap nonaktif menyebabkan crash 500, bukan 404 | ✅ F3 |
| XC-7 / XC-12 / XC-15 / STK-11 / ORD-13 | Error, otorisasi, dan lapisan tidak konsisten; model raksasa | 🧱 |
| XC-8 / STK-12 | Dua salinan konversi satuan dengan semantik berbeda | 🧱 (satu tabel bersama, dua varian eksplisit) |
| API-4 / SEC-M4 / ORD-11 | `GET /api/order` mengembalikan seluruh riwayat, dan dashboard melakukan polling | 📋 butuh perubahan frontend |
| API-8 | Frontend belanja mengirim `unitPrice = total/qty` dibulatkan, sehingga total bergeser | 📋 frontend |

### Medium (terpilih)

| ID | Masalah | Status |
|---|---|---|
| AUTH-11 / MENU-10 / API-10 | Upload gambar ditulis ke disk sebelum cek admin, meninggalkan file yatim | ✅ F5 |
| (metode kas) | `method: "constructor"` lolos validasi dan menyebabkan SQL error 500 | ✅ F4 |
| BOOT-11 / AUTH-3 | `NODE_ENV` default `development`: stack trace terbuka, endpoint info LAN aktif, cookie tidak secure | ⚖️ D6 |
| AUTH-7 | Logout memasang ulang cookie kosong selama 30 hari, tidak menghapusnya | 📋 |
| AUTH-12 | Tanpa rate limit di login/register | 📋 |
| ORD-2 / STK-8 / GAP-5 | Race condition stok dan urutan lock yang bisa memicu deadlock | 📋 |
| ORD-9 | Nomor order bisa dipakai ulang setelah order terakhir bulan itu dihapus | 📋 |
| MENU-09 / XC-11 / XC-M1 | `PUT /menu-item` adalah full replace: field yang tidak dikirim akan menghapus resep atau gambar | 📋 (kontrak frontend) |
| STK-6 | `PUT /stock-item` tanpa `stock` mengubah stok menjadi 0 | 📋 |
| BOOT-23 / BOOT-24 / MENU-M1 / MENU-M2 / BOOT-8 / BOOT-9 / OP-5 | Seed/backfill lain yang menimpa data saat boot | ⚖️ D4 |
| GAP-1 | Pemotongan stok dibulatkan 2 desimal oleh MySQL, sedangkan nilai stok tidak | 📋 |
| GAP-3 | Tanggal order online bebas, termasuk masa depan | 📋 |
| GAP-4 / REC-17 | Tanggal di Redux basi setelah tengah malam; profit mingguan memakai sumber campuran | 📋 frontend |

## 4. Perubahan yang dilakukan

### 4.1 Baseline (sebelum mengubah kode)

- Membuat **tes karakterisasi** `tests/characterization/`:
  - menjalankan `app.js` asli terhadap database sementara;
  - 177 langkah yang mencakup semua endpoint, role, dan cabang error;
  - merekam status, header kontrak, body, event Socket.IO, isi semua tabel, dan isi tabel setelah restart.
- Baseline direkam dari kode lama dan dicek deterministik dua kali.
- Tes `scripts/test-shopping.js` yang sudah ada dijalankan: PASS.

### 4.2 Refactor struktural (tanpa perubahan perilaku)

Dikerjakan per modul, dan setelah setiap modul tes karakterisasi harus PASS. Urutannya: infrastruktur, users, categories, platforms, stock, shopping, menu, recaps, orders.

| Lama | Baru |
|---|---|
| `app.js` (semua di satu file) | `app.js` (entry Passenger, 2 baris) → `src/server.js` + `src/app.js` + `src/config/cors.js` |
| `config/config.js` | `src/config/env.js` (+ `paths.js`) |
| `config/database.js` | `src/infrastructure/database/pool.js` + `bootstrap/{index,helpers,seedData,menuCatalog,platforms,orderCodes}.js` (urutan statement identik) |
| `config/shoppingSchema.js` | `src/infrastructure/database/bootstrap/shoppingSchema.js` |
| `config/socket.js` | `src/infrastructure/realtime/socket.js` |
| `middlewares/*` | `src/shared/middleware/{authenticate,errorHandler}.js` + `authorize.js`, `validateParams.js` (baru) |
| `utils/networkAddresses.js` | `src/shared/utils/networkAddresses.js` |
| `utils/thermalPrintStore.js` | `src/modules/orders/thermalPrint.store.js` |
| `routes/userRoute.js` + `controllers/userController.js` + `models/userModel.js` | `src/modules/users/user.{routes,controller,service,repository}.js` |
| `…/categoryRoute` + `categoryController` + `categoryModel` | `src/modules/categories/category.{routes,controller,repository}.js` |
| `…/orderPlatformRoute` + `orderPlatformController` + `orderPlatformModel` | `src/modules/platforms/platform.{routes,controller,repository}.js` |
| `…/stockItemRoute` + `stockItemController` + `stockItemModel` | `src/modules/stock/stock.{routes,controller,repository}.js` |
| bagian stok di `orderModel` | `src/modules/stock/stock.movements.js` |
| `routes/shoppingRoute.js` + `models/shoppingModel.js` | `src/modules/shopping/shopping.{routes,controller,service,validation}.js` |
| `…/menuItemRoute` + `menuItemController` + `menuItemModel` | `src/modules/menu/menu.{routes,controller,service,repository,pricing,options,images,upload}.js` |
| `…/recapRoute` + `recapController` + `recapModel` | `src/modules/recaps/recap.{routes,controller,service,repository,payload}.js` |
| `…/orderRoute` + `orderController` + `orderModel` | `src/modules/orders/order.{routes,controller,service,repository,code,items,recapLock,snapshots,validation}.js` + `orderPrint.controller.js` |
| `scripts/test-shopping.js` | `tests/integration/shopping.test.js` |

**Perbaikan kualitas dalam refactor:**
- **Otorisasi deklaratif di route** (`requireRole`, `requireNumericId`), menggantikan sekitar 25 salinan cek inline. Urutan guard per endpoint tetap sama dengan kode lama.
- **`asyncHandler`** menggantikan try/catch berulang. Semua error bisnis kini memakai `http-errors` dengan status dan pesan yang sama.
- **`withTransaction`** menggantikan boilerplate transaksi (kecuali `order.create`, yang harus melepas lock setelah commit).
- **Helper bersama** di `src/shared/utils`: `money`, `units`, `orderCode`, `dbErrors`.
- **Logika duplikat menu** (harga dasar, harga online, profit) di create/update kini satu fungsi `buildMenuItemRecord`.
- **Logger JSON terstruktur.** Error 5xx kini tercatat; format response tidak berubah.
- **Kode mati dihapus** setelah dibuktikan dengan grep: `updateCateringPaymentAmount`, export yang tidak dipakai, `defaultCategories`, parameter `largePrice`, dependensi `crypto`, `"main"` diarahkan ke `app.js`.
- **ESLint 8** (kompatibel Node 18.8), **unit test** dengan `node:test`, dan npm script `lint`/`test*`.

### 4.3 Perbaikan bug (perubahan perilaku yang disengaja)

| # | Bug | Perbaikan | Bukti / tes |
|---|---|---|---|
| F1 | Boot menonaktifkan stok non-seed | Pemanggilan `deactivateRowsOutsideList` dihapus. Tidak ada data yang diaktifkan ulang atau dihapus | Baseline lama: 4 barang uji `active=1 → 0` setelah restart. Satu-satunya diff baseline setelah fix adalah keempat baris itu tetap `1`. Tes regresi "keeps non-seed stock items active…" |
| F2 | Backfill kode order: key `MM-YY` vs `YYMM` menghasilkan duplikat, server gagal start | Key disamakan menjadi `YYMM` | Tes regresi mereproduksi `Duplicate entry '2601-0001'` di kode lama; kini order kedua mendapat `2601-0002` |
| F3 | Format rekap nonaktif: crash di `mapMeta(undefined)` → 500 | Repository mengembalikan `null` → 404 "Recap format not found!" (cabang yang memang ada di controller) | Tes regresi: 500 → 404 |
| F4 | Metode kas `constructor`/`toString` lolos ke SQL → 500 | Cek `Object.hasOwn` → 400 "Metode kas tidak valid." | Tes regresi |
| F5 | Upload gambar oleh non-admin tetap tersimpan di disk | Cek role sebelum multer; response 403 tetap sama | Tes regresi: kode lama meninggalkan file `…-kasir.png` |

Baseline karakterisasi diperbarui **hanya** untuk F1 (4 nilai `is_active` setelah restart). Ke-177 response HTTP tidak berubah.

## 5. Hasil pengujian

Status akhir: semua lulus.

| Pemeriksaan | Hasil |
|---|---|
| `npm run lint` (ESLint) | 0 error |
| `npm run test:unit` (9 suite, `node:test`) | lulus |
| `tests/integration/shopping.test.js` (transaksi, rollback, konkurensi) | PASS, sebelum dan sesudah refactor |
| `tests/integration/regressions.test.js` (4 tes untuk F1–F5) | gagal di kode lama, lulus setelah fix |
| `npm run test:characterization` (177 langkah, 21 tabel, restart) | PASS di setiap tahap refactor |
| `node --check` semua file | lulus |

**Yang tidak diverifikasi:**
- Skema database **production** (`rnbmanag_demokopiniskala`). Tes memakai database baru yang dibangun oleh migrasi startup, dan skema production bisa berbeda bila ada `runSafeMigration` yang pernah gagal diam-diam.
- Uji manual di UI frontend dan aplikasi RawBT. Kontraknya dijaga oleh tes karakterisasi, tetapi alurnya belum dicoba di perangkat.
- Proses deploy Passenger. Entry point `app.js` tetap sama, tetapi belum dicoba di server.

## 6. Keputusan yang membutuhkan persetujuan

| # | Topik | Rekomendasi |
|---|---|---|
| D1 | **Registrasi publik bisa membuat Admin** (critical) | Wajibkan login admin untuk `POST /api/user/register`, kecuali saat tabel `users` masih kosong (bootstrap admin pertama). Halaman Register di frontend perlu disesuaikan |
| D2 | **Nilai uang dari klien** (total, pajak, harga, fee, DP, HPP ×1,3) | Hitung ulang di server dari harga menu dan pajak kategori, dengan rumus yang sama dengan `Bill.jsx`; tolak bila berbeda. Pindahkan aturan HPP ×1,3 ke backend |
| D3 | **Rekap oleh kasir dan angka dari klien** | Tetapkan siapa yang boleh closing harian. Hitung angka rekap di server dari tabel `orders` |
| D4 | **Seed/backfill boot yang menimpa data** (BOOT-2/3/5/8/9/23/24, OP-5, MENU-M1/M2) | Ubah seed menjadi insert-only (hanya mengisi yang belum ada). Jadikan backfill one-shot dengan penanda di tabel migrasi |
| D5 | **Migrasi runtime → migrasi berversi** | Dump skema production (`mysqldump --no-data`), bandingkan dengan `schema.sql`, buat migration baseline + tabel `schema_migrations`, lalu jalankan migrasi saat deploy, bukan saat boot |
| D6 | **Konfigurasi keamanan** | Set `NODE_ENV=production` di server (Passenger biasanya sudah melakukannya), rotasi `JWT_SECRET`, hapus secret Midtrans yang tidak dipakai dari `.env` backend dan frontend (GAP-8) |
| D7 | **Akuntansi stok saat hapus order / edit belanja** | Catat ledger mutasi stok saat order dibuat dan kembalikan persis nilai itu; cegah `stock_value` negatif |
| D8 | **Status lunas catering** | Tentukan sumber kebenaran: `is_paid` atau nominal DP |
| D9 | **Hapus kategori yang masih punya menu** | Tolak (409) atau soft delete, sebagai ganti cascade |

## 7. Risiko tersisa dan mitigasi

| Risiko | Mitigasi |
|---|---|
| Migrasi saat boot tetap berjalan di setiap restart Passenger | F1 menghentikan efek paling merusak. Sisanya di D4/D5 |
| Branch ini juga berisi WIP penghapusan fitur pembayaran: startup akan `DROP TABLE payments` dan kolom `midtrans_*` | Fitur memang sudah dipensiunkan; **jalankan `scripts/backup-database.sh` sebelum deploy** |
| Server dev (`npm run dev` / nodemon) di mesin lokal otomatis memuat ulang kode refactor terhadap database `pos_system` lokal selama pengerjaan | Perilakunya identik dengan baseline. Kode baru hanya berbeda pada F1–F5 |
| Dependensi dev baru (`eslint@8`, `@eslint/js`, `globals`, `socket.io-client`) | Hanya devDependencies; tidak dimuat di production |
| Frontend belum diuji ulang secara manual | Kontrak dijaga tes karakterisasi; lakukan smoke test POS, rekap, dan cetak RawBT sebelum merge ke `production` |

## 8. Roadmap lanjutan

1. **D1 + D6** (keamanan, cepat): kunci registrasi admin, `NODE_ENV`, rotasi secret.
2. **D5 → D4** (data): migration baseline, lalu seed insert-only.
3. **D2 + D3** (integritas keuangan): perhitungan uang dan rekap di server, dengan frontend menyesuaikan.
4. **D7**: ledger stok; perbaiki STK-3, ORD-2, GAP-1, GAP-5 sekaligus. Pindahkan mutasi stok dari shopping ke `stock.movements`.
5. **Pagination `GET /api/order`** dan endpoint agregasi untuk dashboard, bersama perubahan frontend.
6. Validasi body order (ORD-7/XC-17), rate limit login (AUTH-12), logout yang benar-benar menghapus cookie (AUTH-7).
