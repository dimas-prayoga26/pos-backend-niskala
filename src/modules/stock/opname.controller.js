// Stock Opname (Modul 3): staff send the physical count of the bahan they
// counted; each stock becomes its count and the selisih is kept as
// Kehilangan Persediaan (see opname.repository). Admins undo the latest count
// of an item.
const createHttpError = require("http-errors");
const { emitRealtimeEvent } = require("../../infrastructure/realtime/socket");
const asyncHandler = require("../../shared/http/asyncHandler");
const Opname = require("./opname.repository");

const OPNAME_LIST_LIMIT = 200;
const MAX_COUNTS = 1000;

const isDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
const isKind = (kind) => Object.hasOwn(Opname.KINDS, kind);

// { kind, counts: [{ itemId, actualStock }], note } with every count a
// number of 0 or more and each bahan once.
const readOpnameInput = (body = {}) => {
  if (!isKind(body.kind)) throw createHttpError(400, "Jenis harus raw atau semi.");
  const counts = Array.isArray(body.counts) ? body.counts : [];
  if (!counts.length) throw createHttpError(400, "Isi stok fisik minimal satu bahan.");
  if (counts.length > MAX_COUNTS) throw createHttpError(400, `Maksimal ${MAX_COUNTS} bahan per stock opname.`);

  const parsed = counts.map((count) => {
    const itemId = Number(count?.itemId);
    const actualStock = count?.actualStock === "" || count?.actualStock == null ? NaN : Number(count.actualStock);
    if (!Number.isInteger(itemId) || itemId <= 0) throw createHttpError(400, "Bahan stock opname tidak valid.");
    if (!Number.isFinite(actualStock) || actualStock < 0) {
      throw createHttpError(400, "Stok fisik harus angka 0 atau lebih.");
    }
    return { itemId, actualStock: Math.round(actualStock * 100) / 100 };
  });
  if (new Set(parsed.map((count) => count.itemId)).size !== parsed.length) {
    throw createHttpError(400, "Satu bahan hanya boleh dihitung sekali per stock opname.");
  }

  return { kind: body.kind, counts: parsed, note: String(body.note || "").trim().slice(0, 255) };
};

const recordOpname = asyncHandler(async (req, res) => {
  const { kind, ...input } = readOpnameInput(req.body);
  const result = await Opname.recordOpname(kind, input, req.user?.id || req.user?._id);

  if (result.lines.length) emitRealtimeEvent("stock:changed", { action: "stock-opname-recorded", kind });
  res.status(201).json({
    success: true,
    message: result.lines.length ? "Stock opname disimpan." : "Stok fisik cocok dengan sistem.",
    data: result,
  });
});

const NO_OPNAMES = { opnames: [], dailyTotals: [] };

// Counts between from and to, newest first, and the Kehilangan Persediaan
// per business day. kind=raw or kind=semi lists one kind only (each tab's
// Riwayat Opname); without it both are summed (Metrik).
const getOpnames = asyncHandler(async (req, res, next) => {
  const { from, to, kind } = req.query;
  if ((from && !isDate(from)) || (to && !isDate(to))) {
    return next(createHttpError(400, "Tanggal harus berformat YYYY-MM-DD."));
  }
  if (kind && !isKind(kind)) return next(createHttpError(400, "Jenis harus raw atau semi."));

  const filters = { from: from || null, to: to || null, limit: OPNAME_LIST_LIMIT };
  const [raw, semi] = await Promise.all([
    kind === "semi" ? NO_OPNAMES : Opname.listOpnames("raw", filters),
    kind === "raw" ? NO_OPNAMES : Opname.listOpnames("semi", filters),
  ]);
  const opnames = [...raw.opnames, ...semi.opnames]
    .sort(
      (a, b) =>
        b.opnameDate.localeCompare(a.opnameDate) ||
        String(b.createdAt).localeCompare(String(a.createdAt)) ||
        b.id - a.id
    )
    .slice(0, OPNAME_LIST_LIMIT);

  const totalsByDate = new Map();
  for (const day of [...raw.dailyTotals, ...semi.dailyTotals]) {
    const total = totalsByDate.get(day.date) || { date: day.date, cost: 0, entries: 0 };
    total.cost = Math.round((total.cost + day.cost) * 100) / 100;
    total.entries += day.entries;
    totalsByDate.set(day.date, total);
  }
  const dailyTotals = [...totalsByDate.values()].sort((a, b) => b.date.localeCompare(a.date));

  res.status(200).json({ success: true, data: { opnames, dailyTotals } });
});

// The Terpakai of the Stock Opname form: what today's orders took from each
// bahan of one kind since its last count today ([{ itemId, quantity }]).
const getOrderUsage = asyncHandler(async (req, res, next) => {
  if (!isKind(req.query.kind)) return next(createHttpError(400, "Jenis harus raw atau semi."));

  res.status(200).json({ success: true, data: { usage: await Opname.listOrderUsage(req.query.kind) } });
});

const deleteOpname = asyncHandler(async (req, res, next) => {
  const { kind } = req.params;
  if (!isKind(kind)) return next(createHttpError(404, "Stock opname tidak ditemukan."));

  const itemId = await Opname.deleteOpname(kind, Number(req.params.opnameId));
  if (itemId === null) return next(createHttpError(404, "Stock opname tidak ditemukan."));

  emitRealtimeEvent("stock:changed", { action: "stock-opname-deleted", kind, itemId });
  res.status(200).json({ success: true, message: "Stock opname dibatalkan." });
});

module.exports = { deleteOpname, getOpnames, getOrderUsage, recordOpname };
