// Input normalization for purchases. Every helper throws http-errors 400.
const createError = require("http-errors");
const { areConvertible, convertBetweenUnits } = require("../../shared/utils/units");

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
const unit = value => clean(value, 30, "Satuan").toLowerCase();
const reference = (id, name, idKey, nameKey, label) => {
  if (id != null && id !== "") {
    if (name != null && name !== "") throw createError(400, `${label}: pilih ID atau nama baru.`);
    return { [idKey]: number(id, 1, 4294967295, 0, label) };
  }
  return { [nameKey]: clean(name, 150, label) };
};
// Strict conversion: incompatible units are rejected (orders convert leniently).
const convertQuantity = (qty, from, to) => {
  const a = unit(from), b = unit(to);
  let converted = qty;
  if (a !== b) {
    if (!areConvertible(a, b)) {
      throw createError(400, `Satuan ${from} tidak cocok dengan stok ${to}. Gunakan satuan stok atau satuan yang bisa dikonversi.`);
    }
    converted = convertBetweenUnits(qty, a, b);
  }
  return number(converted, 0.01, 9999999999.99, 2, "Qty setelah konversi (minimal 0,01 satuan stok)");
};
const normalizePurchase = body => {
  const requestId = clean(body.requestId, 64, "ID permintaan");
  if (!/^[a-zA-Z0-9-]{16,64}$/.test(requestId)) throw createError(400, "ID permintaan tidak valid.");
  const date = clean(body.date, 10, "Tanggal");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date) {
    throw createError(400, "Tanggal tidak valid.");
  }
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 100) throw createError(400, "Isi 1 sampai 100 barang.");
  return {
    requestId, date, ...reference(body.suplierId, body.suplierName, "suplierId", "suplierName", "Toko/sumber"),
    paymentMethod: clean(body.paymentMethod, 80, "Pembayaran"),
    note: body.note ? clean(body.note, 500, "Catatan") : "",
    items: body.items.map(item => ({
      ...reference(item?.stockItemId, item?.itemName, "stockItemId", "itemName", "Barang"),
      quantity: number(item?.quantity, 0.001, 999999999, 3, "Qty"),
      unit: unit(item?.unit),
      unitPrice: number(item?.unitPrice, 0, 999999999999.99, 2, "Harga satuan"),
    })),
  };
};
const normalizeItemPatch = body => ({
  quantity: number(body?.quantity, 0.001, 999999999, 3, "Qty"),
  unit: unit(body?.unit),
  unitPrice: number(body?.unitPrice, 0, 999999999999.99, 2, "Harga satuan"),
});

module.exports = {
  clean,
  convertQuantity,
  normalizeItemPatch,
  normalizePurchase,
  number,
};
