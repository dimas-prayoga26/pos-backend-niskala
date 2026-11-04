// Buang (wastage, Modul 3) of bahan baku and bahan olahan: what was
// thrown away leaves stock and is kept as kerugian, the Biaya Wastage of the
// P&L (apart from HPP). Shared here: the reasons, the request checks and the
// bukti foto. Photos are stored under WASTE_PHOTO_DIR (outside the public
// uploads folder) and served to logged-in users only by
// GET /api/stock-item/waste-photos/:kind/:id.
const createHttpError = require("http-errors");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { WASTE_PHOTO_DIR } = require("../../config/paths");
const { pool } = require("../../infrastructure/database/pool");
const { isAdmin } = require("../../shared/middleware/authorize");
const { detectImageType, displayName } = require("../shopping/shopping.attachments");

// Reasons staff pick. The system adds "Sisa akhir hari" (daily recap) and
// "Penyesuaian" (stock count); older rows may also say "Tumpah".
const WASTE_REASONS = ["Basi", "Jatuh", "Gosong", "Expired", "Lainnya"];

const PHOTO_TABLES = {
  raw: "history_stock_raw_waste_attachments",
  semi: "history_stock_semi_waste_attachments",
};

const photoUrl = (kind, id) => `/api/stock-item/waste-photos/${kind}/${id}`;

// The quantity, reason and note of a Buang, and its photos (multer memory
// files, typed by their bytes). Kasir must attach a photo; admins may not.
const readWasteInput = (req) => {
  const quantity = Math.round(Math.max(Number(req.body?.quantity) || 0, 0) * 100) / 100;
  const reason = String(req.body?.reason || "").trim();
  const note = String(req.body?.note || "").trim().slice(0, 255);

  if (quantity <= 0) throw createHttpError(400, "Jumlah yang dibuang harus lebih dari 0.");
  if (!WASTE_REASONS.includes(reason)) {
    throw createHttpError(400, `Alasan harus salah satu dari: ${WASTE_REASONS.join(", ")}.`);
  }
  const photos = (Array.isArray(req.files) ? req.files : []).map((file) => {
    const type = detectImageType(file.buffer);
    if (!type) throw createHttpError(400, `${displayName(file.originalname) || "File"} bukan foto JPG, PNG, atau WEBP.`);
    return { file, type };
  });
  if (!photos.length && !isAdmin(req)) throw createHttpError(400, "Lampirkan foto barang yang dibuang.");

  return { quantity, reason, note, photos };
};

// Writes the photos of a new write-off in the caller's transaction. written
// collects the file names so a failed write-off can remove them.
const savePhotos = async (connection, kind, wasteId, photos = [], userId, written) => {
  if (!photos.length) return;
  await fs.mkdir(WASTE_PHOTO_DIR, { recursive: true });
  for (const { file, type } of photos) {
    const fileName = `${kind}-${wasteId}-${crypto.randomBytes(12).toString("hex")}${type.ext}`;
    await fs.writeFile(path.join(WASTE_PHOTO_DIR, fileName), file.buffer, { flag: "wx" });
    written.push(fileName);
    await connection.query(
      `INSERT INTO ${PHOTO_TABLES[kind]}
        (waste_id, file_name, original_name, mime_type, size_bytes, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [wasteId, fileName, displayName(file.originalname), type.mime, file.buffer.length, userId || null]
    );
  }
};

const removePhotoFiles = (fileNames) =>
  Promise.all(fileNames.map((name) => fs.unlink(path.join(WASTE_PHOTO_DIR, name)).catch(() => {})));

// Runs work(written) and removes the photo files it wrote when it fails.
const withPhotoFiles = async (work) => {
  const written = [];
  try {
    return await work(written);
  } catch (error) {
    await removePhotoFiles(written);
    throw error;
  }
};

// File names of a write-off's photos, read before the write-off is deleted
// (its photo rows go with it: ON DELETE CASCADE).
const photoFileNames = async (connection, kind, wasteId) => {
  const [rows] = await connection.query(`SELECT file_name FROM ${PHOTO_TABLES[kind]} WHERE waste_id = ?`, [wasteId]);
  return rows.map((row) => row.file_name);
};

// Adds photos: [{ id, url }] to each listed write-off.
const withPhotos = async (kind, wastes) => {
  if (!wastes.length) return wastes;
  const [rows] = await pool.query(
    `SELECT id, waste_id FROM ${PHOTO_TABLES[kind]} WHERE waste_id IN (?) ORDER BY id`,
    [wastes.map((waste) => waste.id)]
  );
  const byWaste = new Map();
  for (const row of rows) {
    if (!byWaste.has(row.waste_id)) byWaste.set(row.waste_id, []);
    byWaste.get(row.waste_id).push({ id: row.id, url: photoUrl(kind, row.id) });
  }
  return wastes.map((waste) => ({ ...waste, photos: byWaste.get(waste.id) || [] }));
};

const findPhoto = async (kind, id) => {
  if (!PHOTO_TABLES[kind]) return null;
  const [[row]] = await pool.query(`SELECT mime_type, file_name FROM ${PHOTO_TABLES[kind]} WHERE id = ?`, [id]);
  return row ? { mimeType: row.mime_type, filePath: path.join(WASTE_PHOTO_DIR, row.file_name) } : null;
};

module.exports = {
  WASTE_REASONS,
  findPhoto,
  photoFileNames,
  readWasteInput,
  removePhotoFiles,
  savePhotos,
  withPhotoFiles,
  withPhotos,
};
