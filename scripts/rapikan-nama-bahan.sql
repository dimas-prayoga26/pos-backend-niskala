-- Rapikan nama bahan baku dan bahan olahan ke Title Case:
--   CABE MERAH BESAR -> Cabe Merah Besar, CLEO 200 ML -> Cleo 200 ml, SKM tetap SKM.
-- Aturannya sama dengan src/shared/utils/names.js (dipakai aplikasi untuk
-- bahan baru; di sini tanda hubung hanya dua yang pertama, Coca-Cola).
-- Beberapa ejaan juga dibetulkan (daftar `ejaan` di bawah).
-- Nama di riwayat (belanja, kerugian, catat masak, HPP pesanan) yang sama
-- dengan nama lama ikut diganti. Stok, COGS, resep, dan HPP tidak berubah.
--
-- Jalankan sekaligus di phpMyAdmin (tab SQL). Export dulu stock_raw_items dan
-- stock_semi_items sebagai cadangan. Aman dijalankan ulang: hasil kosong
-- berarti semua nama sudah rapi. Status BENTROK = nama barunya sudah dipakai
-- bahan lain, jadi dilewati.

START TRANSACTION;

DROP TEMPORARY TABLE IF EXISTS nama_sumber;
CREATE TEMPORARY TABLE nama_sumber (
  tbl VARCHAR(4) NOT NULL,
  id INT UNSIGNED NOT NULL,
  nama_lama VARCHAR(150) NOT NULL,
  nama VARCHAR(150) NOT NULL,
  PRIMARY KEY (tbl, id)
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

INSERT INTO nama_sumber (tbl, id, nama_lama, nama)
SELECT 'raw', id, name, TRIM(REGEXP_REPLACE(name, '[[:space:]]+', ' ')) FROM stock_raw_items;
INSERT INTO nama_sumber (tbl, id, nama_lama, nama)
SELECT 'semi', id, name, TRIM(REGEXP_REPLACE(name, '[[:space:]]+', ' ')) FROM stock_semi_items;

-- Ejaan yang dibetulkan (huruf besar/kecil tidak berpengaruh).
DROP TEMPORARY TABLE IF EXISTS ejaan;
CREATE TEMPORARY TABLE ejaan (
  salah VARCHAR(150) NOT NULL,
  benar VARCHAR(150) NOT NULL
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
INSERT INTO ejaan (salah, benar) VALUES
  ('SAUS BLACK PAPER', 'Saus Black Pepper'),
  ('SAUS TERAYAKI', 'Saus Teriyaki'),
  ('SELAI STROWBERRY', 'Selai Strawberry'),
  ('SYRUP BUTTERSCOTH', 'Syrup Butterscotch'),
  ('SYRUP CLASSC CARAMEL', 'Syrup Classic Caramel'),
  ('TEPUNG MEIZENA', 'Tepung Maizena'),
  ('SAMBEL GEPREK', 'Sambal Geprek');
UPDATE nama_sumber s JOIN ejaan e ON e.salah = s.nama SET s.nama = e.benar;

-- [hitung-mulai] Title Case per kata, lalu digabung lagi.
DROP TEMPORARY TABLE IF EXISTS nama_baru;
CREATE TEMPORARY TABLE nama_baru (
  tbl VARCHAR(4) NOT NULL,
  id INT UNSIGNED NOT NULL,
  nama_lama VARCHAR(150) NOT NULL,
  nama_baru VARCHAR(150) NOT NULL,
  status VARCHAR(10) NOT NULL DEFAULT 'SAMA',
  PRIMARY KEY (tbl, id)
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

INSERT INTO nama_baru (tbl, id, nama_lama, nama_baru)
SELECT tbl, id, MIN(nama_lama), GROUP_CONCAT(kata ORDER BY n SEPARATOR ' ')
FROM (
  SELECT tbl, id, nama_lama, n,
    CASE
      WHEN w REGEXP '[0-9]' THEN w
      WHEN BINARY w <> BINARY UPPER(w) AND BINARY SUBSTRING(w, 2) <> BINARY LOWER(SUBSTRING(w, 2)) THEN w
      WHEN UPPER(w) IN ('SKM', 'UHT', 'MSG', 'BBQ') THEN UPPER(w)
      WHEN LOWER(w) IN ('ml', 'gr', 'kg', 'mg', 'oz', 'pcs', 'cc', 'ltr') AND prev REGEXP '^[0-9.,]+$' THEN LOWER(w)
      WHEN n > 1 AND LOWER(w) IN ('and', 'dan', 'or', 'atau', 'with', 'of') THEN LOWER(w)
      ELSE IF(h2 > 0, CONCAT(LEFT(c2, h2), UPPER(SUBSTRING(c2, h2 + 1, 1)), SUBSTRING(c2, h2 + 2)), c2)
    END AS kata
  FROM (
    SELECT c.*, IF(h1 > 0, LOCATE('-', c2, h1 + 1), 0) AS h2
    FROM (
      SELECT b.*, IF(h1 > 0, CONCAT(LEFT(c1, h1), UPPER(SUBSTRING(c1, h1 + 1, 1)), SUBSTRING(c1, h1 + 2)), c1) AS c2
      FROM (
        SELECT a.*, LOCATE('-', c1) AS h1
        FROM (
          SELECT k.*,
            CASE
              WHEN LEFT(LOWER(w), 1) IN ('(', '"', '''')
                THEN CONCAT(LEFT(LOWER(w), 1), UPPER(SUBSTRING(LOWER(w), 2, 1)), SUBSTRING(LOWER(w), 3))
              ELSE CONCAT(UPPER(LEFT(LOWER(w), 1)), SUBSTRING(LOWER(w), 2))
            END AS c1
          FROM (
            SELECT s.tbl, s.id, s.nama_lama, d.n,
              SUBSTRING_INDEX(SUBSTRING_INDEX(s.nama, ' ', d.n), ' ', -1) AS w,
              IF(d.n > 1, SUBSTRING_INDEX(SUBSTRING_INDEX(s.nama, ' ', d.n - 1), ' ', -1), '') AS prev
            FROM nama_sumber s
            JOIN (
              SELECT 1 AS n UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
              UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8
              UNION ALL SELECT 9 UNION ALL SELECT 10 UNION ALL SELECT 11 UNION ALL SELECT 12
              UNION ALL SELECT 13 UNION ALL SELECT 14 UNION ALL SELECT 15 UNION ALL SELECT 16
            ) d ON d.n <= 1 + CHAR_LENGTH(s.nama) - CHAR_LENGTH(REPLACE(s.nama, ' ', ''))
          ) k
        ) a
      ) b
    ) c
  ) words
) titled
GROUP BY tbl, id;
-- [hitung-selesai]

-- UBAH kalau berbeda (termasuk huruf besar/kecil) dan namanya belum dipakai bahan lain.
UPDATE nama_baru nb
SET nb.status = CASE
  WHEN BINARY nb.nama_baru = BINARY nb.nama_lama THEN 'SAMA'
  WHEN EXISTS (SELECT 1 FROM stock_raw_items t
               WHERE t.name COLLATE utf8mb4_unicode_ci = nb.nama_baru AND NOT (nb.tbl = 'raw' AND t.id = nb.id))
    OR EXISTS (SELECT 1 FROM stock_semi_items t
               WHERE t.name COLLATE utf8mb4_unicode_ci = nb.nama_baru AND NOT (nb.tbl = 'semi' AND t.id = nb.id))
    OR EXISTS (SELECT 1 FROM stock_supply_items t WHERE t.name COLLATE utf8mb4_unicode_ci = nb.nama_baru)
    THEN 'BENTROK'
  ELSE 'UBAH'
END;

UPDATE stock_raw_items s
JOIN nama_baru nb ON nb.tbl = 'raw' AND nb.id = s.id AND nb.status = 'UBAH'
SET s.name = nb.nama_baru;
UPDATE stock_semi_items s
JOIN nama_baru nb ON nb.tbl = 'semi' AND nb.id = s.id AND nb.status = 'UBAH'
SET s.name = nb.nama_baru;

-- Riwayat yang masih memakai nama lama.
UPDATE history_stock_raw_purchase_items x
JOIN nama_baru nb ON nb.tbl = 'raw' AND nb.id = x.stock_item_id AND nb.status = 'UBAH'
SET x.item_name = nb.nama_baru
WHERE x.item_name COLLATE utf8mb4_unicode_ci = nb.nama_lama;
UPDATE history_stock_raw_wastes x
JOIN nama_baru nb ON nb.tbl = 'raw' AND nb.id = x.stock_item_id AND nb.status = 'UBAH'
SET x.item_name = nb.nama_baru
WHERE x.item_name COLLATE utf8mb4_unicode_ci = nb.nama_lama;
UPDATE stock_semi_item_production_items x
JOIN nama_baru nb ON nb.tbl = 'raw' AND nb.id = x.stock_item_id AND nb.status = 'UBAH'
SET x.item_name = nb.nama_baru
WHERE x.item_name COLLATE utf8mb4_unicode_ci = nb.nama_lama;
UPDATE order_item_costs x
JOIN nama_baru nb ON nb.tbl = 'raw' AND nb.id = x.stock_item_id AND nb.status = 'UBAH'
SET x.stock_item_name = nb.nama_baru
WHERE x.semi_item_id IS NULL AND x.stock_item_name COLLATE utf8mb4_unicode_ci = nb.nama_lama;
UPDATE history_stock_semi_wastes x
JOIN nama_baru nb ON nb.tbl = 'semi' AND nb.id = x.semi_item_id AND nb.status = 'UBAH'
SET x.item_name = nb.nama_baru
WHERE x.item_name COLLATE utf8mb4_unicode_ci = nb.nama_lama;
UPDATE stock_semi_item_productions x
JOIN nama_baru nb ON nb.tbl = 'semi' AND nb.id = x.semi_item_id AND nb.status = 'UBAH'
SET x.item_name = nb.nama_baru
WHERE x.item_name COLLATE utf8mb4_unicode_ci = nb.nama_lama;
UPDATE order_item_costs x
JOIN nama_baru nb ON nb.tbl = 'semi' AND nb.id = x.semi_item_id AND nb.status = 'UBAH'
SET x.stock_item_name = nb.nama_baru
WHERE x.stock_item_name COLLATE utf8mb4_unicode_ci = nb.nama_lama;

COMMIT;

SELECT IF(tbl = 'raw', 'Bahan Baku', 'Bahan Olahan') AS jenis, nama_lama, nama_baru,
  IF(status = 'UBAH', 'DIUBAH', status) AS status
FROM nama_baru
WHERE status <> 'SAMA'
ORDER BY status, jenis, nama_baru;
