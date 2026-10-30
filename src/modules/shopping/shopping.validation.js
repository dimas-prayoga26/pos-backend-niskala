// Input normalization for purchases. Every helper throws http-errors 400.
const createError = require("http-errors");
const { areConvertible, convertBetweenUnits } = require("../../shared/utils/units");
const { clean, dateKey, number } = require("../../shared/utils/validate");
const { SUPPLY_CATEGORIES } = require("../stock/supply.repository");

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
const STATUSES = ["draft", "posted"];
// Footer: ongkir, Diskon Nota (Rp or %) and PPN (%). Only non-default values
// are returned, so the payload hash of a nota without them stays as before.
const normalizeAdjustments = body => {
  const discountType = body.discountType == null || body.discountType === "" ? "amount" : body.discountType;
  if (!["amount", "percent"].includes(discountType)) throw createError(400, "Jenis diskon harus Rp atau %.");
  const optional = (value, max, label) => (value == null || value === "" ? 0 : number(value, 0, max, 2, label));
  const adjustments = {
    shippingCost: optional(body.shippingCost, 999999999999.99, "Ongkos kirim"),
    discountType,
    discountValue: optional(body.discountValue, discountType === "percent" ? 100 : 999999999999.99, "Diskon nota"),
    taxPercent: optional(body.taxPercent, 100, "PPN"),
  };
  const isDefault = !adjustments.shippingCost && !adjustments.discountValue && !adjustments.taxPercent;
  return isDefault ? null : adjustments;
};
// One nota: the header is shared by belanja bahan baku and perlengkapan;
// normalizeItem reads a line (stockItemId or supplyItemId). status "draft"
// keeps the nota without moving stock or saldo until it is posted.
// requireRequestId is false when an existing draft is changed.
const normalizeNota = (body, normalizeItem, { requireRequestId = true } = {}) => {
  const requestId = requireRequestId ? clean(body.requestId, 64, "ID permintaan") : undefined;
  if (requireRequestId && !/^[a-zA-Z0-9-]{16,64}$/.test(requestId)) throw createError(400, "ID permintaan tidak valid.");
  const date = dateKey(body.date);
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 100) throw createError(400, "Isi 1 sampai 100 barang.");
  const status = body.status == null || body.status === "" ? "posted" : body.status;
  if (!STATUSES.includes(status)) throw createError(400, "Status nota harus draft atau posted.");
  const adjustments = normalizeAdjustments(body);
  return {
    ...(requireRequestId && { requestId }),
    date, ...reference(body.suplierId, body.suplierName, "suplierId", "suplierName", "Toko/sumber"),
    // A payment source (Kasir, Rekening Penjualan, ...) also posts saldo
    // keluar; a free-text paymentMethod (older clients) only labels the nota.
    ...(body.paymentSourceId != null && body.paymentSourceId !== ""
      ? { paymentSourceId: number(body.paymentSourceId, 1, 4294967295, 0, "Sumber pembayaran") }
      : { paymentMethod: clean(body.paymentMethod, 80, "Sumber pembayaran") }),
    note: body.note ? clean(body.note, 500, "Catatan") : "",
    items: body.items.map(normalizeItem),
    ...(adjustments && { adjustments }),
    ...(status === "draft" && { status }),
  };
};
// Isi per kemasan (optional): the line is quantity packages (unit: dus,
// pack, ...) of packSize packUnit each (isi 24 botol); packUnit defaults to
// the item's stock unit.
const packOf = item =>
  item?.packSize == null || item.packSize === ""
    ? {}
    : {
      packSize: number(item.packSize, 0.001, 1000000, 3, "Isi per kemasan"),
      ...(item?.packUnit ? { packUnit: unit(item.packUnit) } : {}),
    };
const round3 = value => Math.round(value * 1000) / 1000;
// The stock quantity of a line: packages x isi, else the quantity, in the stock unit.
const stockQuantityOf = ({ quantity, unit: lineUnit, packSize, packUnit }, stockUnit) =>
  packSize
    ? convertQuantity(round3(quantity * packSize), packUnit || stockUnit, stockUnit)
    : convertQuantity(quantity, lineUnit, stockUnit);
// Harga total of a line (optional): kept as typed, so a price per gr or ml
// with more than 2 decimals does not change it (19.000 ml for Rp 8.000).
const totalOf = item =>
  item?.total == null || item.total === "" ? {} : { total: number(item.total, 0, 999999999999.99, 2, "Harga total") };
// unitRequired false: a line without unit takes its item's unit (Lainnya).
const normalizeLine = (item, idKey, { unitRequired = true } = {}) => ({
  ...reference(item?.[idKey], item?.itemName, idKey, "itemName", "Barang"),
  quantity: number(item?.quantity, 0.001, 999999999, 3, "Qty"),
  ...(unitRequired || item?.unit ? { unit: unit(item?.unit) } : {}),
  ...packOf(item),
  unitPrice: number(item?.unitPrice, 0, 999999999999.99, 2, "Harga satuan"),
  ...totalOf(item),
});
const normalizePurchase = (body, options) => normalizeNota(body, item => normalizeLine(item, "stockItemId"), options);
// Barang Lainnya need no unit; a new one (itemName) needs its category.
const normalizeSupplyPurchase = (body, options) => normalizeNota(body, item => {
  const line = normalizeLine(item, "supplyItemId", { unitRequired: false });
  if (!line.itemName) return line;
  if (!SUPPLY_CATEGORIES.includes(item?.category)) {
    throw createError(400, `Pilih kategori ${line.itemName}: ${SUPPLY_CATEGORIES.join(", ")}.`);
  }
  return { ...line, category: item.category };
}, options);
// packSize in a patch is in the stock unit; null or "" drops it, absent keeps it.
const normalizeItemPatch = (body, { unitRequired = true } = {}) => ({
  quantity: number(body?.quantity, 0.001, 999999999, 3, "Qty"),
  ...(unitRequired || body?.unit ? { unit: unit(body?.unit) } : {}),
  ...(body && "packSize" in body
    ? { packSize: body.packSize == null || body.packSize === "" ? null : number(body.packSize, 0.001, 1000000, 3, "Isi per kemasan") }
    : {}),
  unitPrice: number(body?.unitPrice, 0, 999999999999.99, 2, "Harga satuan"),
  ...totalOf(body),
});

module.exports = {
  clean,
  convertQuantity,
  normalizeItemPatch,
  normalizePurchase,
  normalizeSupplyPurchase,
  number,
  round3,
  stockQuantityOf,
};
