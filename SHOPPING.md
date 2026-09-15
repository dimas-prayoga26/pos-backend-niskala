# Bahan Belanjaan

UI: Dashboard → Stok → Bahan Belanjaan → Tambah Bahan Belanjaan (admin).

- Satu belanja memiliki tanggal, satu toko/sumber, pembayaran, catatan, dan banyak barang.
- Urutan per barang: nama (Select2), qty, satuan, harga satuan, jumlah. Jumlah = qty × harga satuan.
- Pilih opsi **Buat** pada Select2 untuk menambahkan nama sementara ke form. Mengetik, memilih, atau menutup form belum menulis data ke database.
- Saat **Simpan Belanjaan** diklik, toko baru dibuat di **suplier**, barang baru di **stock_items**, riwayat dicatat, dan stok ditambahkan dalam satu transaksi. Jika gagal, seluruh perubahan dibatalkan.
- Barang baru memakai kategori `Umum`, minimum stok 0, dan satuan dari baris pembelian pertamanya. Nama yang sudah ada digunakan kembali, termasuk jika dibuat pengguna lain selama form terbuka.
- Pilihan sementara yang tidak dipakai pada belanja tidak ikut disimpan. Form yang ditutup masih menyimpan draf selama komponen terbuka; memuat ulang halaman membuang draf.
- Inisialisasi schema hanya menyiapkan tabel dan tidak menambahkan supplier secara otomatis. Data yang sudah tersimpan tetap tersedia.
- Pembelian kg bisa masuk stok g/gr/gram; liter/l bisa masuk stok ml. Satuan lainnya harus sama (pcs/pc/buah dianggap setara). Ukuran kemasan seperti dus ke pcs tidak ditebak; masukkan qty dalam satuan stok.
- Nama barang/supplier, harga, satuan beli dan konversi dicatat sebagai snapshot pada riwayat. Stok negatif dapat bertambah secara normal dari posisi sebelumnya.
- ID permintaan unik mencegah simpan ulang jaringan menggandakan stok. Perubahan nama barang, supplier, satuan stok, dan penerimaan belanja tetap mengikuti izin admin.

## Pengaturan Suplier

Pengaturan memiliki menu Platform dan Suplier. Admin dapat menambah atau mengubah nama suplier melalui tombol Simpan. Nama duplikat ditolak. Mengubah nama master tidak mengganti nama pada riwayat belanja yang sudah tersimpan. Pilihan Select2 di form belanja tetap sementara sampai Simpan Belanjaan diklik.

## Deployment

Jalankan backend seperti biasa: `ensureShoppingSchema` membuat ketiga tabel d idempoten setelah koneksi database siap. Gunakan pengguna database dengan izin CREATE TABLE dan REFERENCES. Tidak ada tabel stok lama yang dihapus. Frontend memerlukan `npm install` untuk dependency baru jQuery 3.7.1 dan Select2 4.0.13, lalu `npm run build`.

## Pengujian

`node scripts/test-shopping.js` membuat database sementara bernama `pos_shopping_test_<acak>`, menjalankan pengujian transaksi dan konkurensi, kemudian menghapus database pengujian itu. Pengguna DB pengujian membutuhkan CREATE/DROP DATABASE. Data stok POS tidak dipakai sebagai data uji.
