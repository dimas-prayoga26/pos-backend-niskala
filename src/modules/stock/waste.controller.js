// Buang (wastage, Modul 3): bahan baku thrown away, the Riwayat Kerugian of
// bahan baku and bahan olahan together, and their bukti foto. The
// Buang of bahan olahan itself is in semi.controller.
const createHttpError = require("http-errors");
const { emitRealtimeEvent } = require("../../infrastructure/realtime/socket");
const asyncHandler = require("../../shared/http/asyncHandler");
const RawWaste = require("./rawWaste.repository");
const SemiItem = require("./semi.repository");
const { findPhoto, readWasteInput } = require("./wastes");

const WASTE_LIST_LIMIT = 200;

const isDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));

const recordRawWaste = asyncHandler(async (req, res, next) => {
  const stockItemId = Number(req.params.id);
  const recorded = await RawWaste.recordWaste(stockItemId, readWasteInput(req), req.user?.id || req.user?._id);
  if (!recorded) return next(createHttpError(404, "Bahan baku tidak ditemukan."));

  emitRealtimeEvent("stock:changed", { action: "stock-item-wasted", stockItemId });
  res.status(201).json({ success: true, message: "Kerugian dicatat." });
});

const deleteRawWaste = asyncHandler(async (req, res, next) => {
  const stockItemId = await RawWaste.deleteWaste(Number(req.params.wasteId));
  if (stockItemId === null) return next(createHttpError(404, "Catatan buang tidak ditemukan."));

  emitRealtimeEvent("stock:changed", { action: "stock-item-waste-deleted", stockItemId });
  res.status(200).json({ success: true, message: "Catatan buang dibatalkan." });
});

const NO_WASTES = { wastes: [], dailyTotals: [] };

// Every write-off between from and to, newest first, each with its kind
// ("raw" or "semi") and itemId, and the total kerugian per business day.
// kind=raw or kind=semi lists one kind only (each tab's Riwayat Kerugian);
// without it both are summed (Biaya Wastage, Rekap Harian).
const getWastes = asyncHandler(async (req, res, next) => {
  const { from, to, kind } = req.query;
  if ((from && !isDate(from)) || (to && !isDate(to))) {
    return next(createHttpError(400, "Tanggal harus berformat YYYY-MM-DD."));
  }
  if (kind && kind !== "raw" && kind !== "semi") {
    return next(createHttpError(400, "Jenis harus raw atau semi."));
  }

  const filters = { from: from || null, to: to || null, limit: WASTE_LIST_LIMIT };
  const [raw, semi] = await Promise.all([
    kind === "semi" ? NO_WASTES : RawWaste.listWastes(filters),
    kind === "raw" ? NO_WASTES : SemiItem.listWastes(filters),
  ]);
  const wastes = [
    ...raw.wastes.map((waste) => ({ ...waste, kind: "raw", itemId: waste.stockItemId })),
    ...semi.wastes.map((waste) => ({ ...waste, kind: "semi", itemId: waste.semiItemId })),
  ]
    .sort(
      (a, b) =>
        b.wasteDate.localeCompare(a.wasteDate) ||
        String(b.createdAt).localeCompare(String(a.createdAt)) ||
        b.id - a.id
    )
    .slice(0, WASTE_LIST_LIMIT);

  const totalsByDate = new Map();
  for (const day of [...raw.dailyTotals, ...semi.dailyTotals]) {
    const total = totalsByDate.get(day.date) || { date: day.date, cost: 0, entries: 0 };
    total.cost = Math.round((total.cost + day.cost) * 100) / 100;
    total.entries += day.entries;
    totalsByDate.set(day.date, total);
  }
  const dailyTotals = [...totalsByDate.values()].sort((a, b) => b.date.localeCompare(a.date));

  res.status(200).json({ success: true, data: { wastes, dailyTotals } });
});

// Served inline to logged-in users only; a photo never changes, so the
// browser may cache it privately.
const getWastePhoto = asyncHandler(async (req, res, next) => {
  const photo = await findPhoto(req.params.kind, Number(req.params.id));
  if (!photo) return next(createHttpError(404, "Foto bukti tidak ditemukan."));

  res.set({
    "Cache-Control": "private, max-age=86400",
    "Content-Disposition": "inline",
    "X-Content-Type-Options": "nosniff",
  });
  res.type(photo.mimeType);
  res.sendFile(photo.filePath, (error) => {
    if (error && !res.headersSent) {
      res.status(404).json({ status: 404, message: "File foto bukti tidak ditemukan." });
    }
  });
});

module.exports = { deleteRawWaste, getWastePhoto, getWastes, recordRawWaste };
