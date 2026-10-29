# Belanja

UI: Dashboard → **Belanja** → Tambah Belanja (draft: admin atau kasir; posting: admin). Menu **Stok** hanya berisi isi gudang: Bahan Baku, Bahan Setengah Jadi, Lainnya. Badge angka di menu Belanja = jumlah draft nota yang menunggu posting.

- Satu belanja (nota) memiliki tanggal, satu toko/sumber, sumber pembayaran, catatan, foto bukti nota, dan banyak barang.
- Urutan per barang: nama (Select2), qty, satuan, harga satuan, jumlah. Jumlah = qty × harga satuan.
- Pilih opsi **Buat** pada Select2 untuk menambahkan nama sementara ke form. Mengetik, memilih, atau menutup form belum menulis data ke database.
- Saat **Simpan Belanjaan** diklik, toko baru dibuat di **suplier**, barang baru di **stock_raw_items** (bahan baku), riwayat dicatat, dan stok ditambahkan dalam satu transaksi. Jika gagal, seluruh perubahan dibatalkan.
- Barang baru memakai kategori `Umum`, minimum stok 0, dan satuan dari baris pembelian pertamanya. Nama yang sudah ada digunakan kembali, termasuk jika dibuat pengguna lain selama form terbuka.
- Pilihan sementara yang tidak dipakai pada belanja tidak ikut disimpan. Form yang ditutup masih menyimpan draf selama komponen terbuka; memuat ulang halaman membuang draf.
- Inisialisasi schema hanya menyiapkan tabel dan tidak menambahkan supplier secara otomatis. Data yang sudah tersimpan tetap tersedia.
- Pembelian kg bisa masuk stok g/gr/gram; liter/l bisa masuk stok ml. Satuan lainnya harus sama (pcs/pc/buah dianggap setara). Ukuran kemasan seperti dus ke pcs tidak ditebak; masukkan qty dalam satuan stok.
- Nama barang/supplier, harga, satuan beli dan konversi dicatat sebagai snapshot pada riwayat. Stok negatif dapat bertambah secara normal dari posisi sebelumnya.
- ID permintaan unik mencegah simpan ulang jaringan menggandakan stok. Perubahan nama barang, supplier, satuan stok, dan penerimaan belanja tetap mengikuti izin admin.

## Ringkasan & Finalisasi Nota

- Footer form: **Subtotal** (jumlah baris barang), **Ongkos Kirim / Ekspedisi**, **Diskon Nota** (Rp atau %, paling besar sebesar subtotal), **Pajak (PPN)** bila supplier mengenakan (persen dari subtotal setelah diskon, default 11%), dan **Grand Total** = subtotal − diskon + PPN + ongkir. Grand Total inilah yang memotong saldo sumber pembayaran.
- Disimpan di header nota (`subtotal`, `shipping_cost`, `discount_type`/`discount_value`/`discount_amount`, `tax_percent`/`tax_amount`, `total`) untuk bahan baku dan lainnya.
- Selisih Grand Total − Subtotal dibagi ke setiap baris sebanding nilainya (`cost_total`; sisa pembulatan ke baris terbesar). `cost_total` yang masuk ke nilai stok dan COGS, jadi ongkir dan PPN ikut HPP dan diskon menguranginya.

## HPP Rata-rata saat Posting

- Saat nota diposting, dalam satu transaksi: saldo sumber pembayaran berkurang sebesar Grand Total, dan harga modal setiap barang dihitung ulang (`shopping.costing`):
  **Harga Satuan Baru = ((Stok Lama × Harga Modal Lama) + Nilai Masuk) / (Stok Lama + Stok Masuk)**, dengan Nilai Masuk = `cost_total` baris.
- Contoh: Gula 2.000 g @ Rp 15 (Rp 30.000) + beli 1.000 g Rp 18.000 → Rp 48.000 / 3.000 g = **Rp 16/g**. HPP resep dan menu (`menu.costs`) langsung dihitung ulang, dan penjualan berikutnya membekukan Rp 16/g di `order_item_costs`.
- Stok minus (terjual sebelum dibeli) ikut dihitung dengan nilai minusnya, jadi barang masuk menutup minus dulu. Contoh FRESHMILK −2.000 ml @ Rp 20 + 3.000 ml Rp 59.100 → Rp 19/ml. Bila stok masih ≤ 0 setelah masuk (atau nilainya jadi minus), harga modal = harga beli nota ini dan nilai stok 0.
- `unit_cost` disimpan rupiah bulat; `stock_value` menyimpan nilai persisnya.
- Ubah/hapus item nota yang sudah diposting menghitung ulang footer (ongkir tetap, diskon % dan PPN mengikuti subtotal baru), membagi ulang ke semua baris, dan menggeser stok serta saldo sebesar selisihnya.
- Perhitungan ada di `shopping.totals` (backend) dan `utils/notaTotals.js` (form); keduanya harus sama.

## Draft dan Posting

- **Simpan Draft** (admin atau kasir): nota tersimpan dengan `status = draft`. Stok, COGS, dan saldo belum berubah; barang baru belum dibuat; riwayat belanja belum menampilkannya. Bukti nota boleh ditambah ke draft.
- **Simpan & Posting** (admin saja): stok naik, barang baru dibuat, saldo keluar dicatat, `status = posted`, `posted_at`/`posted_by` diisi. Kasir yang mencoba posting mendapat 403.
- Menu Belanja menampilkan **Draft Nota Menunggu Posting**: admin membuka dengan *Periksa & Posting*, kasir dengan *Ubah*; keduanya bisa menghapus draft (beserta fotonya). Nota yang sudah diposting tidak bisa dihapus atau diubah lewat draft.
- API: `POST /purchases` (`status: "draft"` atau tanpa status = posting), `GET /purchases/drafts`, `PUT /purchases/:id` (ubah draft; `status: "posted"` memposting), `DELETE /purchases/:id` (draft saja); sama untuk `/supply-purchases`.
- Kasir melihat daftar sumber pembayaran tanpa saldo (`balance: null`).

## Riwayat Belanja: Per Struk dan Per Bahan

- **Filter Periode (atas riwayat):** Hari Ini, Minggu Ini (Senin–Minggu), Bulan Ini (bawaan), Tahun Ini, Semua Waktu, atau Custom Date (kalender yang sama dengan filter tanggal Pesanan: pilih dua tanggal lalu Apply, Today, Reset; hari dihitung menurut zona Jakarta). Berlaku untuk Per Struk, Per Bahan/Per Barang, dan TOTAL PENGELUARAN (dikirim sebagai `from`/`to`, YYYY-MM-DD, kedua tanggal ikut). **Peralatan** adalah aset sehingga tabnya selalu seumur hidup: filter periode dimatikan di sana. Draft nota dan detail barang tidak ikut difilter.
- **Export Excel / PDF:** semua nota tab, periode, dan pencarian yang aktif (semua halaman, `pageSize` sampai 1000), disusun seperti sheet REKAP PENGELUARAN: tanggal, nota, toko di baris pertama tiap nota, barang, sumber pembayaran, qty, harga, jumlah, baris Ongkir/Diskon/PPN, Total, dan TOTAL PENGELUARAN di akhir. PDF memakai halaman cetak browser (Simpan sebagai PDF); jendelanya dibuka saat tombol diklik agar tidak diblokir sebagai pop-up.
- Tab kategori sudah menunjukkan kategorinya, jadi baris barang tidak memakai label kategori.
- Riwayat di menu Belanja punya dua tampilan (tombol **Per Struk | Per Bahan**; di tab Lainnya **Per Struk | Per Barang**), keduanya mengikuti tab Bahan Baku / kategori Lainnya dan kotak pencarian, 10 per halaman.
- **Per Struk** (tampilan awal): nota yang sudah diposting, terbaru dulu, disusun seperti notanya: nama toko sebagai judul (tanggal, nomor nota, pembuat dan pemosting, catatan, tombol **Bukti**), lalu satu baris per barang: sumber pembayaran (sekali per nota), qty, harga, dan jumlah. Lalu baris Ongkir / Diskon / PPN bila ada, dan **Total** (Grand Total) di bawah kolom Jumlah. Contoh: Shopee, Niskala, Spork 500 × Rp 275 = Rp 137.500, Cutlery Set 500 × Rp 505 = Rp 252.500, Ongkir 1 × Rp 336, Total Rp 390.336.
- Baris terakhir tabel: **TOTAL PENGELUARAN**, jumlah Grand Total semua nota di tab dan pencarian itu (semua halaman, bukan hanya halaman yang tampil), beserta jumlah notanya (`totalSpending` dan `total` dari endpoint). Nota campuran (mis. Peralatan + Promosi) dihitung penuh di setiap tab kategori yang memuatnya.
- Kolom Masuk Stok dan COGS tidak ditampilkan di Per Struk; lihat Per Bahan atau detail barang.
- **Per Bahan / Per Barang**: satu baris per barang dengan belanja terakhirnya (tanggal, nomor nota, toko, qty, harga, jumlah, Masuk Stok, COGS Setelah), dari `GET /api/shopping/purchases` / `GET /api/shopping/supply-purchases` (Lainnya dengan `category`). Tidak ada TOTAL PENGELUARAN di sini karena tiap baris hanya menampilkan belanja terakhir.
- Klik barang (di kedua tampilan) membuka detail barang itu: Stok Sekarang, Nilai Asset, COGS Sekarang, riwayat belanjanya (dengan COGS Setelah) dan Log Aktivitas. Admin mengubah atau menghapus baris belanja dari sini (Update/Delete).
- Endpoint: `GET /api/shopping/purchases/notas` dan `GET /api/shopping/supply-purchases/notas` (`search`, `page`; Lainnya juga `category`). Pencarian cocok dengan nama toko atau salah satu barang di nota. Di tab kategori, nota tampil jika memuat barang dengan kategori itu (kategori barang yang sekarang), jadi nota campuran Peralatan + Promosi muncul di kedua tab dengan semua barangnya. Detail barang memakai `GET /api/shopping/purchases?itemId=` / `GET /api/shopping/supply-purchases?itemId=` (riwayat satu barang).

## Sumber Pembayaran dan Saldo

- **Pengaturan → Sumber Pembayaran** (admin) berisi daftar `meta_data_payment_source` beserta saldonya: Kasir (Tunai), Rekening Penjualan, dan Niskala dibuat sekali saat boot dengan saldo Rp 0. Sumber bisa ditambah, diganti nama, atau dinonaktifkan, tetapi tidak dihapus.
- Setiap perubahan saldo adalah satu baris `history_payment_source_mutations`: `amount_in` (saldo masuk), `amount_out` (saldo keluar), dan `balance_after` (saldo setelahnya). Hanya `paymentSource.ledger` yang menulisnya, di dalam transaksi pemanggil.
- **Posting** nota dengan `paymentSourceId` mencatat Grand Total sebagai saldo keluar (`reference_type = purchase`, `reference_id` = id belanja) dalam transaksi yang sama. Id sumber disimpan di `payment_source_id` dan namanya disalin ke `payment_method`.
- **Ubah / hapus item belanja** mencatat selisihnya ke sumber yang sama (`purchase_edit`: harga naik = saldo keluar, turun = saldo masuk; `purchase_delete`: total item kembali sebagai saldo masuk). Riwayat mutasi tidak pernah diubah atau dihapus.
- **Catat Saldo** (`POST /api/payment-source/:id/mutations`, `type` in/out) untuk modal awal, setoran, atau uang yang diambil.
- Saldo boleh minus (uang sudah keluar); form belanja dan Pengaturan menampilkannya merah.
- Belanja lama (sebelum fitur ini) dan klien lama yang masih mengirim `paymentMethod` teks tidak memotong saldo.

## Bukti Nota

- Form belanja punya tombol **Ambil Foto** (kamera belakang di HP/tablet) dan **Pilih dari Galeri**, maksimal 5 foto. Foto diperkecil di browser (JPEG, sisi terpanjang 1600 px) lalu diunggah setelah belanja tersimpan (`POST /api/shopping/purchases/:id/attachments`, multipart `files`).
- Server hanya menerima JPG/PNG/WEBP berdasarkan isi file (bukan nama), maksimal 5 MB per foto dan 10 foto per belanja. File disimpan di `storage/purchase-receipts/` dengan nama acak, dicatat di `history_stock_raw_purchase_attachments`.
- Folder `storage/` tidak publik dan diabaikan git. Foto dibuka lewat `GET /api/shopping/purchase-attachments/:id` (wajib login). Admin bisa menambah atau menghapus bukti dari riwayat belanja (tombol **Bukti**).
- Jika unggah foto gagal, belanja tetap tersimpan; tambahkan fotonya dari riwayat.
- **Backup production:** sertakan folder `storage/` selain database.

## Belanja Lainnya (Peralatan, Perlengkapan, Promosi, Lain-lain)

Dulu bernama "Perlengkapan"; tabelnya tetap `stock_supply_*` dan endpoint-nya tetap `/supply-...`.

- Satu pintu: belanja lainnya dibuat dari form yang sama, **Tambah Belanja**, dengan **Jenis Belanja: Lainnya**. Informasi Nota (tanggal, toko, sumber pembayaran, bukti nota) sama dengan belanja bahan baku. Mengganti jenis mengosongkan baris barang, header nota tetap.
- Barangnya disimpan di `stock_supply_items` (tab **Lainnya** di Stok), bukan di `stock_raw_items`: tidak muncul di resep menu dan tidak masuk HPP. Barang baru (opsi **Buat**) wajib diberi kategori Peralatan, Perlengkapan, Promosi, atau Lain-lain (kategori lama Operasional otomatis menjadi Perlengkapan).
- **Tanpa satuan:** barang Lainnya dihitung per barang. Form, riwayat, dan tab Lainnya tidak menampilkan satuan; baris tanpa satuan memakai satuan barangnya, barang baru `pcs`.
- Nota disimpan di `history_stock_supply_purchases` + `_items` (`POST /api/shopping/supply-purchases`, idempoten dengan `request_id` seperti belanja bahan baku). Stok dan harga per barang memakai rata-rata bergerak.
- Karena tidak masuk HPP, riwayat dan detail barang Lainnya menyebut rata-rata itu **Harga Rata-rata** (Harga Rata-rata Sekarang / Setelah), bukan COGS. Angka yang sama dipakai untuk Nilai Asset.
- Dibayar dari sumber pembayaran: total dicatat sebagai saldo keluar `supply_purchase`; ubah/hapus item mencatat selisihnya (`supply_purchase_edit` / `supply_purchase_delete`).
- Bukti nota: `history_stock_supply_purchase_attachments`, endpoint `/api/shopping/supply-purchases/:id/attachments` dan `/api/shopping/supply-purchase-attachments/:id`.
- Nama barang hanya boleh ada di satu jenis: nama bahan baku/setengah jadi ditolak sebagai barang lainnya, dan sebaliknya.
- Riwayat: menu Belanja punya tab **Bahan Baku | Peralatan | Perlengkapan | Promosi | Lain-lain**. Tab kategori memanggil `GET /api/shopping/supply-purchases?category=...` (bentuk data sama dengan riwayat bahan baku) dan memakai kategori barang yang sekarang, jadi barang yang kategorinya diubah pindah tab beserta riwayatnya. Setelah posting, riwayat membuka tab kategori baris pertama nota.
- Tab Lainnya menampilkan **Qty**, Nilai, dan Harga per Barang. Barang Lainnya bukan bahan yang di-restock, jadi tidak ada Minimum, status stok (AMAN/HAMPIR HABIS), atau Bebas Stok; semua barang dihitung qty-nya sesuai belanja (termasuk Lain-lain dan Promosi).
- Tab Lainnya tidak punya tombol tambah: barang dan qty awal masuk lewat belanja (qty awal dicatat sebagai belanja, misalnya dari "Stok Awal Niskala"). Di sana ada **Sesuaikan** (hitung ulang qty, admin/kasir), **Ubah** (nama, kategori, supplier) dan **Hapus** (admin). Pemakaian barang belum dicatat terpisah.

## Pengaturan Suplier

Pengaturan memiliki menu Platform, Suplier, dan Sumber Pembayaran. Admin dapat menambah atau mengubah nama suplier melalui tombol Simpan. Nama duplikat ditolak. Mengubah nama master tidak mengganti nama pada riwayat belanja yang sudah tersimpan. Pilihan Select2 di form belanja tetap sementara sampai Simpan Belanjaan diklik.

## Deployment

Jalankan backend seperti biasa: `ensureShoppingSchema` membuat ketiga tabel d idempoten setelah koneksi database siap. Gunakan pengguna database dengan izin CREATE TABLE dan REFERENCES. Tidak ada tabel stok lama yang dihapus. Frontend memerlukan `npm install` untuk dependency baru jQuery 3.7.1 dan Select2 4.0.13, lalu `npm run build`.

## Pengujian

`node tests/integration/shopping.test.js` membuat database sementara bernama `pos_shopping_test_<acak>`, menjalankan pengujian transaksi dan konkurensi, kemudian menghapus database pengujian itu. Pengguna DB pengujian membutuhkan CREATE/DROP DATABASE. Data stok POS tidak dipakai sebagai data uji.
