const createHttpError = require("http-errors");
const Recap = require("./recap.repository");

const ALLOWED_PERIOD_TYPES = ["daily", "weekly", "monthly"];
const CASH_COLUMN_BY_METHOD = {
  cash: "cash_in",
  qris: "qris_in",
  transfer: "transfer_in",
};
const CASH_LABEL_BY_METHOD = { qris: "QRIS", transfer: "Transfer" };

const isValidPeriodType = (periodType) => ALLOWED_PERIOD_TYPES.includes(periodType);

const findAll = async (periodType) => {
  if (periodType === "daily") return Recap.findDailyRecaps();
  if (periodType === "weekly") return Recap.findWeeklyRecaps();
  if (periodType === "monthly") return Recap.findMonthlyRecaps();

  return [];
};

// A daily recap closes the day: orders on that date become read-only.
const createDaily = async (format, payload) => {
  if (await Recap.dailyRecapExistsForDate(payload.recapDate)) {
    throw createHttpError(
      409,
      `Rekap harian tanggal ${payload.recapDate} sudah dibuat. Kamu tidak bisa membuat rekap harian lagi di tanggal yang sama.`
    );
  }

  const user = payload.userId ? null : await Recap.findByName("users", payload.shiftOfficer);
  const bestMenu = payload.bestMenuItemId
    ? null
    : await Recap.findByName("menu_items", payload.bestMenu);
  const leastMenu = payload.leastMenuItemId
    ? null
    : await Recap.findByName("menu_items", payload.leastMenu);

  const insertId = await Recap.insertDaily(format, payload, { user, bestMenu, leastMenu });
  const recaps = await Recap.findDailyRecaps();
  return recaps.find((recap) => recap.id === insertId) || null;
};

// Weekly and monthly recaps are upserted per period.
const upsertWeekly = async (format, payload) => {
  await Recap.upsertWeekly(format, payload);

  const recaps = await Recap.findWeeklyRecaps();
  return recaps.find(
    (recap) =>
      String(recap.periodStartDate).slice(0, 10) === payload.periodStartDate &&
      String(recap.periodEndDate).slice(0, 10) === payload.periodEndDate
  );
};

const upsertMonthly = async (format, payload) => {
  await Recap.upsertMonthly(format, payload);

  const recaps = await Recap.findMonthlyRecaps();
  return recaps.find((recap) => recap.periodMonth === payload.periodMonth);
};

const create = async (periodType, payload) => {
  const format = await Recap.findFormatByCode(periodType);

  if (!format) return null;

  if (periodType === "daily") return createDaily(format, payload);
  if (periodType === "weekly") return upsertWeekly(format, payload);
  if (periodType === "monthly") return upsertMonthly(format, payload);

  return null;
};

const addDailyCash = async ({ recapId, method, amount, note }) => {
  const cashColumn = Object.hasOwn(CASH_COLUMN_BY_METHOD, method)
    ? CASH_COLUMN_BY_METHOD[method]
    : null;

  if (!cashColumn) {
    throw createHttpError(400, "Metode kas tidak valid.");
  }

  const normalizedAmount = Number(amount) || 0;
  if (normalizedAmount <= 0) {
    throw createHttpError(400, "Nominal kas harus lebih dari 0.");
  }

  const cleanNote = String(note || "").trim();
  const cashLabel = CASH_LABEL_BY_METHOD[method] || "Cash";
  const kasNote = cleanNote
    ? `Tambah kas ${cashLabel} Rp ${normalizedAmount}: ${cleanNote}`
    : "";

  const updated = await Recap.addCashToDaily({
    recapId,
    cashColumn,
    amount: normalizedAmount,
    kasNote,
  });

  if (!updated) return null;

  const recaps = await Recap.findDailyRecaps();
  return recaps.find((recap) => Number(recap.id) === Number(recapId)) || null;
};

module.exports = {
  addDailyCash,
  create,
  findAll,
  findMeta: Recap.findMeta,
  isValidPeriodType,
};
