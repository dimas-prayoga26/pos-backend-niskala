const createHttpError = require("http-errors");

// Online orders may be booked on a chosen calendar date (YYYY-MM-DD).
const normalizeOrderDateInput = (value) => {
  const date = String(value || "").trim();

  if (!date) return null;

  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    throw createHttpError(400, "Tanggal order tidak valid.");
  }

  const [, year, month, day] = match;
  const parsedDate = new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day))
  );
  const isValidDate =
    !Number.isNaN(parsedDate.getTime()) &&
    parsedDate.getUTCFullYear() === Number(year) &&
    parsedDate.getUTCMonth() + 1 === Number(month) &&
    parsedDate.getUTCDate() === Number(day);

  if (!isValidDate) {
    throw createHttpError(400, "Tanggal order tidak valid.");
  }

  return date;
};

module.exports = { normalizeOrderDateInput };
