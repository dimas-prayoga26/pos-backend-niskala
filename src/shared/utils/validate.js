// Input helpers that throw http-errors 400 with an Indonesian message.
const createError = require("http-errors");

const clean = (value, max, label) => {
  if (typeof value !== "string") throw createError(400, `${label} wajib diisi.`);
  const result = value.trim().replace(/\s+/g, " ");
  if (!result || result.length > max) throw createError(400, `${label} wajib diisi, maksimal ${max} karakter.`);
  return result;
};
const number = (value, min, max, precision, label) => {
  if (value === "" || value == null || typeof value === "boolean") throw createError(400, `${label} tidak valid.`);
  const n = Number(value);
  const rounded = Math.round(n * 10 ** precision) / 10 ** precision;
  if (!Number.isFinite(n) || n < min || n > max || Math.abs(n - rounded) > 1e-7) throw createError(400, `${label} tidak valid.`);
  return rounded;
};
// A real calendar date as YYYY-MM-DD (2026-02-30 is rejected).
const dateKey = (value, label = "Tanggal") => {
  const date = clean(value, 10, label);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date) {
    throw createError(400, `${label} tidak valid.`);
  }
  return date;
};
// Today in the server time zone (TZ is Asia/Jakarta, see config/env).
const todayKey = () => {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
};

module.exports = { clean, dateKey, number, todayKey };
