const createHttpError = require("http-errors");
const { emitRealtimeEvent } = require("../../infrastructure/realtime/socket");
const asyncHandler = require("../../shared/http/asyncHandler");
const { parseNumber } = require("../../shared/utils/money");
const { normalizePayload, validatePayload } = require("./recap.payload");
const recapService = require("./recap.service");

const getRecapMeta = asyncHandler(async (req, res, next) => {
  const { periodType } = req.query;

  if (periodType && !recapService.isValidPeriodType(periodType)) {
    return next(createHttpError(400, "Invalid recap period type!"));
  }

  const meta = await recapService.findMeta({ periodType });
  res.status(200).json({ success: true, data: meta });
});

const getRecaps = asyncHandler(async (req, res, next) => {
  const { periodType } = req.params;

  if (!recapService.isValidPeriodType(periodType)) {
    return next(createHttpError(404, "Invalid recap period type!"));
  }

  const recaps = await recapService.findAll(periodType);
  res.status(200).json({ success: true, data: recaps });
});

const addDailyCash = asyncHandler(async (req, res, next) => {
  const recapId = Number(req.params.id);
  const recap = await recapService.addDailyCash({
    recapId,
    method: String(req.body.method || "cash").toLowerCase(),
    amount: parseNumber(req.body.amount),
    note: String(req.body.note || "").trim(),
  });

  if (!recap) {
    return next(createHttpError(404, "Rekap harian tidak ditemukan."));
  }

  emitRealtimeEvent("recaps:changed", {
    action: "daily-cash-added",
    periodType: "daily",
    recapId: recap.id,
  });

  res.status(200).json({
    success: true,
    message: "Kas berhasil ditambahkan.",
    data: recap,
  });
});

const addRecap = asyncHandler(async (req, res, next) => {
  const { periodType } = req.params;

  if (!recapService.isValidPeriodType(periodType)) {
    return next(createHttpError(404, "Invalid recap period type!"));
  }

  const data = normalizePayload(periodType, req.body, req.user?._id || null);
  const validationError = validatePayload(periodType, data);

  if (validationError) {
    return next(createHttpError(400, validationError));
  }

  const recap = await recapService.create(periodType, data);

  if (!recap) {
    return next(createHttpError(404, "Recap format not found!"));
  }

  emitRealtimeEvent("recaps:changed", {
    action: `${periodType}-recap-saved`,
    periodType,
    recapId: recap.id,
  });

  res.status(201).json({
    success: true,
    message: "Recap saved!",
    data: recap,
  });
});

module.exports = {
  addDailyCash,
  addRecap,
  getRecapMeta,
  getRecaps,
};
