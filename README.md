# POS Backend

API untuk aplikasi POS (kasir, menu, stok, belanja, catering, rekap). Dibangun dengan Node.js 18, Express 4, MySQL 8 (mysql2, SQL manual), JWT dalam cookie, dan Socket.IO untuk pembaruan realtime antar-tablet.

## Menjalankan secara lokal

1. Siapkan MySQL (Laragon: `127.0.0.1:3306`, user `root`).
2. Salin `.env.example` menjadi `.env`, lalu isi minimal `DB_*` dan `JWT_SECRET`.
3. Instal dependensi dan jalankan:

```bash
npm install
npm run dev        # nodemon app.js
npm start          # node app.js (dipakai juga oleh Passenger di production)
npm run network    # cetak URL LAN untuk tablet di Wi-Fi yang sama
```

Database dan tabel dibuat otomatis saat start (lihat `docs/architecture.md` → *Startup dan skema database*). Akses dari jaringan lokal dijelaskan di `../LOCAL-NETWORK.md`.

## Variabel lingkungan

| Variabel | Default | Keterangan |
|---|---|---|
| `PORT` / `HOST` | `8080` / `0.0.0.0` | |
| `NODE_ENV` | `development` | **Set `production` di server.** Mode development menampilkan stack trace di response error, membuka `/api/network-info`, dan memakai cookie tidak secure |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | `localhost`, `3306`, `root`, kosong, `pos_system` | |
| `DB_TIMEZONE` / `TZ` | `+07:00` / `Asia/Jakarta` | Rekap harian dan tanggal order bergantung pada keduanya |
| `JWT_SECRET` | – | Wajib. Server mencetak peringatan bila kosong |
| `CORS_ORIGINS` | – | Origin tambahan, pisahkan dengan koma. Origin Vite lokal/LAN (port 5170–5179) selalu diizinkan |

## Pengujian

Tes membutuhkan MySQL lokal dan membuat database sementara bernama `pos_*test*`. Database `pos_system` tidak pernah disentuh.

```bash
npm run lint                         # ESLint
npm run test:unit                    # fungsi murni, tanpa database
npm run test:integration             # transaksi belanja + tes regresi
npm run test:characterization        # golden master seluruh API (177 langkah)
npm test                             # semuanya
```

Satu file unit test: `node --test tests/unit/domain.test.js`.

Bila tes karakterisasi gagal, artinya perilaku API berubah. Periksa diff yang dicetak. Rekam baseline baru (`npm run test:characterization:update`) **hanya** untuk perubahan yang disengaja, dan catat alasannya di `docs/refactoring-report.md`.

## Struktur

```text
app.js                 entry point (Passenger)
src/server.js          boot: app + Socket.IO + migrasi startup + listen
src/app.js             middleware dan mount route
src/modules/<domain>/  routes → controller → service → repository
src/shared/            middleware (auth, role, error), utils, logger
src/infrastructure/    pool MySQL, migrasi/seed startup, Socket.IO
tests/                 unit, integration, characterization
docs/                  arsitektur, batas modul, laporan refactor
```

Menambah fitur di domain yang sudah ada: tambahkan route di `<domain>.routes.js` beserta guard (`authenticate`, `requireRole`, `requireNumericId`), handler di controller, aturan bisnis di service, dan SQL di repository. Setiap mutasi harus memanggil `emitRealtimeEvent` agar tablet lain ikut diperbarui.

Dokumentasi lanjutan:
- `docs/architecture.md`: lapisan, alur request, transaksi, error, dan keputusan arsitektur.
- `docs/module-boundaries.md`: tanggung jawab dan tabel milik tiap modul.
- `docs/refactoring-report.md`: hasil audit, perubahan, dan keputusan yang masih terbuka.
- `SHOPPING.md`: aturan bisnis belanja bahan.

## Deploy

Production berjalan di Passenger dengan startup file `app.js`; restart dilakukan dengan menyentuh `tmp/restart.txt`. Setiap start menjalankan migrasi skema, jadi **backup database sebelum deploy** (`scripts/backup-database.sh`).
