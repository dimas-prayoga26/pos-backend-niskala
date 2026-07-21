const createHttpError = require("http-errors");
const Recap = require("../models/recapModel");
const { emitRealtimeEvent } = require("../config/socket");

const parseNumber = (value, fallback = 0) => {
  const numericValue = Number(value);

  return Number.isFinite(numericValue) ? numericValue : fallback;
};

const parseIntNumber = (value, fallback = 0) => {
  const numericValue = Number.parseInt(value, 10);

  return Number.isFinite(numericValue) ? numericValue : fallback;
};

const normalizeDate = (value) => {
  if (!value) return "";

  return String(value).slice(0, 10);
};

const getMonthRange = (periodMonth) => {
  if (!periodMonth) return { startDate: "", endDate: "" };

  const [year, month] = periodMonth.split("-").map(Number);

  if (!year || !month) return { startDate: "", endDate: "" };

  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const monthEndDate = new Date(year, month, 0).getDate();
  const monthEnd = `${year}-${String(month).padStart(2, "0")}-${String(
    monthEndDate
  ).padStart(2, "0")}`;

  return { startDate: monthStart, endDate: monthEnd };
};

const validatePeriodType = (periodType) =>
  Recap.allowedPeriodTypes.includes(periodType);

const getRecapMeta = async (req, res, next) => {
  try {
    const { periodType } = req.query;

    if (periodType && !validatePeriodType(periodType)) {
      return next(createHttpError(400, "Invalid recap period type!"));
    }

    const meta = await Recap.findMeta({ periodType });
    res.status(200).json({ success: true, data: meta });
  } catch (error) {
    next(error);
  }
};

const getRecaps = async (req, res, next) => {
  try {
    const { periodType } = req.params;

    if (!validatePeriodType(periodType)) {
      return next(createHttpError(404, "Invalid recap period type!"));
    }

    const recaps = await Recap.findAll(periodType);
    res.status(200).json({ success: true, data: recaps });
  } catch (error) {
    next(error);
  }
};

const normalizeDailyPayload = (body, createdBy) => {
  const recapDate = normalizeDate(body.recapDate || body.date);
  const offlineRevenue = parseNumber(body.offlineRevenue);
  const onlineRevenue = parseNumber(body.onlineRevenue);
  const cateringRevenue = parseNumber(body.cateringRevenue);
  const hppTotal = parseNumber(body.hppTotal);
  const dailyExpense = parseNumber(body.dailyExpense);
  const cashIn = parseNumber(body.cashIn);
  const qrisIn = parseNumber(body.qrisIn);
  const transferIn = parseNumber(body.transferIn);
  const totalRevenue =
    parseNumber(body.totalRevenue, NaN) ||
    offlineRevenue + onlineRevenue + cateringRevenue;
  const grossProfit = parseNumber(body.grossProfit, NaN) || totalRevenue - hppTotal;
  const cashDifference =
    parseNumber(body.cashDifference, NaN) ||
    cashIn + qrisIn + transferIn - totalRevenue;
  const payload = {
    recapDate,
    shiftOfficer: String(body.shiftOfficer || "").trim(),
    userId: body.userId || body.shiftOfficerId || null,
    transactionTotal: parseIntNumber(body.transactionTotal),
    offlineRevenue,
    onlineRevenue,
    cateringRevenue,
    totalRevenue,
    hppTotal,
    grossProfit,
    dailyExpense,
    cashIn,
    qrisIn,
    transferIn,
    cashDifference,
    bestMenu: String(body.bestMenuName || body.bestMenu || "").trim(),
    bestMenuItemId: body.bestMenuItemId || null,
    leastMenu: String(body.leastMenuName || body.leastMenu || "").trim(),
    leastMenuItemId: body.leastMenuItemId || null,
    note: String(body.note || "").trim(),
  };

  return { ...payload, createdBy };
};

const normalizeWeeklyPayload = (body, createdBy) => {
  const periodStartDate = normalizeDate(body.periodStartDate);
  const periodEndDate = normalizeDate(body.periodEndDate);
  const payload = {
    periodStartDate,
    periodEndDate,
    totalOmzet: parseNumber(body.totalOmzet),
    grossProfit: parseNumber(body.grossProfit),
    offlineRevenue: parseNumber(body.offlineRevenue),
    onlineRevenue: parseNumber(body.onlineRevenue),
    cateringRevenue: parseNumber(body.cateringRevenue),
    cateringOrderCount: parseIntNumber(body.cateringOrderCount),
    topChannel: String(body.topChannel || "").trim(),
    operationalIssues: String(body.operationalIssues || "").trim(),
    teamEvaluation: String(body.teamEvaluation || "").trim(),
    stockEvaluation: String(body.stockEvaluation || "").trim(),
    actionPlan: String(body.actionPlan || "").trim(),
    note: String(body.note || "").trim(),
  };

  return { ...payload, createdBy };
};

const normalizeMonthlyPayload = (body, createdBy) => {
  const periodMonth = String(body.periodMonth || "").slice(0, 7);
  const { startDate, endDate } = getMonthRange(periodMonth);
  const payload = {
    periodMonth,
    omzet: parseNumber(body.omzet),
    hppTotal: parseNumber(body.hppTotal),
    grossProfit: parseNumber(body.grossProfit),
    estimatedNetProfit: parseNumber(body.estimatedNetProfit),
    cateringOrderCount: parseIntNumber(body.cateringOrderCount),
    retainedMenu: String(body.retainedMenu || "").trim(),
    evaluatedMenu: String(body.evaluatedMenu || "").trim(),
    promotionEvaluation: String(body.promotionEvaluation || "").trim(),
    supplierEvaluation: String(body.supplierEvaluation || "").trim(),
    nextMonthStrategy: String(body.nextMonthStrategy || "").trim(),
    note: String(body.note || "").trim(),
  };

  return { ...payload, periodStartDate: startDate, periodEndDate: endDate, createdBy };
};

const normalizePayload = (periodType, body, createdBy) => {
  if (periodType === "daily") return normalizeDailyPayload(body, createdBy);
  if (periodType === "weekly") return normalizeWeeklyPayload(body, createdBy);
  if (periodType === "monthly") return normalizeMonthlyPayload(body, createdBy);

  return null;
};

const validatePayload = (periodType, data) => {
  if (periodType === "daily" && !data.recapDate) {
    return "Tanggal recap wajib diisi!";
  }

  if (
    periodType === "weekly" &&
    (!data.periodStartDate || !data.periodEndDate)
  ) {
    return "Periode mingguan wajib diisi!";
  }

  if (
    periodType === "monthly" &&
    (!data.periodStartDate || !data.periodEndDate)
  ) {
    return "Periode bulanan wajib diisi!";
  }

  return null;
};

const addRecap = async (req, res, next) => {
  try {
    const { periodType } = req.params;

    if (!validatePeriodType(periodType)) {
      return next(createHttpError(404, "Invalid recap period type!"));
    }

    const data = normalizePayload(periodType, req.body, req.user?._id || null);
    const validationError = validatePayload(periodType, data);

    if (validationError) {
      return next(createHttpError(400, validationError));
    }

    const recap = await Recap.create(periodType, data);

    if (!recap) {
      return next(createHttpError(404, "Recap format not found!"));
    }

    emitRealtimeEvent("recaps:changed", {
      action: `${periodType}-recap-saved`,
      periodType,
      recapId: recap.id || recap._id,
    });

    res.status(201).json({
      success: true,
      message: "Recap saved!",
      data: recap,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  addRecap,
  getRecapMeta,
  getRecaps,
};
