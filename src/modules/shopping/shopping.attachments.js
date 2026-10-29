// Bukti nota: photos of a purchase's paper receipt, for the finance audit.
// Files are stored in PURCHASE_RECEIPT_DIR (outside the public uploads folder)
// under a random name and only served to logged-in users by
// GET /api/shopping/purchase-attachments/:id (belanja bahan baku) or
// GET /api/shopping/supply-purchase-attachments/:id (belanja perlengkapan).
const createError = require("http-errors");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { PURCHASE_RECEIPT_DIR } = require("../../config/paths");
const { pool } = require("../../infrastructure/database/pool");
const { number } = require("../../shared/utils/validate");

const MAX_ATTACHMENTS_PER_PURCHASE = 10;
// The type comes from the file's first bytes, never from its name or the
// browser's Content-Type, so a renamed file cannot be served as an image.
const IMAGE_TYPES = [
  { mime: "image/jpeg", ext: ".jpg", matches: buffer => buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff },
  { mime: "image/png", ext: ".png", matches: buffer => buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: "image/webp", ext: ".webp", matches: buffer => buffer.toString("latin1", 0, 4) === "RIFF" && buffer.toString("latin1", 8, 12) === "WEBP" },
];

const detectImageType = buffer =>
  Buffer.isBuffer(buffer) && buffer.length >= 12 ? IMAGE_TYPES.find(type => type.matches(buffer)) || null : null;
// Where the photos of each kind of nota are recorded and served.
const RECEIPT_TARGETS = {
  raw: {
    purchases: "history_stock_raw_purchases",
    attachments: "history_stock_raw_purchase_attachments",
    url: id => `/api/shopping/purchase-attachments/${id}`,
    filePrefix: "",
  },
  supply: {
    purchases: "history_stock_supply_purchases",
    attachments: "history_stock_supply_purchase_attachments",
    url: id => `/api/shopping/supply-purchase-attachments/${id}`,
    filePrefix: "supply-",
  },
};
const attachmentUrl = RECEIPT_TARGETS.raw.url;
// The phone's file name without control characters, for display only.
const displayName = name =>
  Array.from(String(name || "")).filter(char => char.charCodeAt(0) > 31 && char.charCodeAt(0) !== 127).join("").trim().slice(0, 255);

const createAttachmentService = (db, dir = PURCHASE_RECEIPT_DIR, target = RECEIPT_TARGETS.raw) => {
  const listForPurchase = async purchaseId => {
    const [rows] = await db.query(
      `SELECT id, original_name, created_at FROM ${target.attachments} WHERE purchase_id = ? ORDER BY id`,
      [purchaseId]
    );
    return rows.map(row => ({ id: row.id, url: target.url(row.id), name: row.original_name, createdAt: row.created_at }));
  };

  const draftOnlyError = () =>
    createError(403, "Bukti nota yang sudah diposting hanya bisa diubah admin.");

  // files: multer memory files ({ buffer, originalname, size }). onlyDraft:
  // the uploader is not an admin, so the nota must still be a draft.
  const add = async (purchaseId, files, userId = null, { onlyDraft = false } = {}) => {
    purchaseId = number(purchaseId, 1, 4294967295, 0, "ID belanja");
    if (!Array.isArray(files) || !files.length) throw createError(400, "Pilih foto bukti nota.");
    const images = files.map(file => {
      const type = detectImageType(file.buffer);
      if (!type) throw createError(400, `${displayName(file.originalname) || "File"} bukan foto JPG, PNG, atau WEBP.`);
      return { file, type };
    });

    await fs.mkdir(dir, { recursive: true });
    const written = [];
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [[purchase]] = await connection.query(
        `SELECT id, status FROM ${target.purchases} WHERE id = ? FOR UPDATE`,
        [purchaseId]
      );
      if (!purchase) throw createError(404, "Belanja tidak ditemukan.");
      if (onlyDraft && purchase.status !== "draft") throw draftOnlyError();
      const [[{ total }]] = await connection.query(
        `SELECT COUNT(*) AS total FROM ${target.attachments} WHERE purchase_id = ?`,
        [purchaseId]
      );
      if (Number(total) + images.length > MAX_ATTACHMENTS_PER_PURCHASE) {
        throw createError(400, `Maksimal ${MAX_ATTACHMENTS_PER_PURCHASE} foto bukti per belanja.`);
      }
      for (const { file, type } of images) {
        const fileName = `${target.filePrefix}${purchaseId}-${crypto.randomBytes(12).toString("hex")}${type.ext}`;
        await fs.writeFile(path.join(dir, fileName), file.buffer, { flag: "wx" });
        written.push(fileName);
        await connection.query(
          `INSERT INTO ${target.attachments}
            (purchase_id, file_name, original_name, mime_type, size_bytes, uploaded_by)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [purchaseId, fileName, displayName(file.originalname), type.mime, file.buffer.length, userId || null]
        );
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      await Promise.all(written.map(name => fs.unlink(path.join(dir, name)).catch(() => {})));
      throw error;
    } finally {
      connection.release();
    }

    return listForPurchase(purchaseId);
  };

  const find = async id => {
    id = number(id, 1, 4294967295, 0, "ID bukti nota");
    const [[row]] = await db.query(`SELECT * FROM ${target.attachments} WHERE id = ?`, [id]);
    if (!row) throw createError(404, "Bukti nota tidak ditemukan.");
    return { id: row.id, purchaseId: row.purchase_id, mimeType: row.mime_type, filePath: path.join(dir, row.file_name) };
  };

  // The row goes first; a file left behind by a failed unlink is harmless.
  const remove = async (id, { onlyDraft = false } = {}) => {
    const attachment = await find(id);
    if (onlyDraft) {
      const [[purchase]] = await db.query(`SELECT status FROM ${target.purchases} WHERE id = ?`, [attachment.purchaseId]);
      if (purchase?.status !== "draft") throw draftOnlyError();
    }
    await db.query(`DELETE FROM ${target.attachments} WHERE id = ?`, [attachment.id]);
    await fs.unlink(attachment.filePath).catch(error => {
      if (error.code !== "ENOENT") throw error;
    });
    return { id: attachment.id, purchaseId: attachment.purchaseId };
  };

  return { add, find, listForPurchase, remove };
};

module.exports = {
  ...createAttachmentService(pool),
  supply: createAttachmentService(pool, PURCHASE_RECEIPT_DIR, RECEIPT_TARGETS.supply),
  MAX_ATTACHMENTS_PER_PURCHASE,
  RECEIPT_TARGETS,
  attachmentUrl,
  createAttachmentService,
  detectImageType,
};
