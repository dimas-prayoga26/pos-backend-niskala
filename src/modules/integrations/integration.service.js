// Pengaturan → API (API Management): the outside services the POS calls and
// their keys. For now the loyalty app (Stamp Card): without a key, or
// switched off, the POS has no loyalty at all (no stamp card, no Hadiah
// Stamp Card, no stamp or Tukar at the cashier).
const createHttpError = require("http-errors");
const config = require("../../config/env");
const logger = require("../../shared/logger");
const { open, seal } = require("../../shared/utils/secretBox");
const repository = require("./integration.repository");

const LOYALTY = "loyalty";
const CACHE_MS = 30 * 1000;
const MAX_URL_LENGTH = 255;
const MAX_KEY_LENGTH = 500;

let loyaltyCache = null;

const forgetCache = () => {
  loyaltyCache = null;
};

// { apiUrl, apiToken } the loyalty client calls with; {} when off or
// without a key. No row yet: .env (moved into the row at boot when set).
const loyaltyConnection = async () => {
  if (loyaltyCache && Date.now() - loyaltyCache.at < CACHE_MS) return loyaltyCache.value;

  const row = await repository.findByCode(LOYALTY);
  let value = {};
  if (!row) {
    value = { apiUrl: config.loyalty.apiUrl, apiToken: config.loyalty.apiToken };
  } else if (row.is_active && row.base_url && row.api_key_sealed) {
    const apiToken = open(row.api_key_sealed);
    if (apiToken) {
      value = { apiUrl: row.base_url, apiToken };
    } else {
      logger.warn("Loyalty API key can't be read (JWT_SECRET changed?): enter it again in Pengaturan → API");
    }
  }

  loyaltyCache = { value, at: Date.now() };
  return value;
};

const isLoyaltyEnabled = async () => {
  const { apiUrl, apiToken } = await loyaltyConnection();
  return Boolean(apiUrl && apiToken);
};

// What the page shows: never the key itself, only its last 4 characters.
const toView = (row) => ({
  code: LOYALTY,
  name: "Loyalty (Stamp Card)",
  baseUrl: row?.base_url || "",
  hasKey: Boolean(row?.api_key_sealed),
  keyHint: row?.api_key_sealed ? row.api_key_hint || "" : "",
  // A key sealed with another JWT_SECRET: it is there but unusable.
  keyUnreadable: Boolean(row?.api_key_sealed) && open(row.api_key_sealed) === null,
  isActive: row ? Boolean(row.is_active) : false,
  updatedAt: row?.updated_at || null,
});

const list = async () => [toView(await repository.findByCode(LOYALTY))];

const assertCode = (code) => {
  if (code !== LOYALTY) throw createHttpError(404, "Integrasi tidak ditemukan.");
};

// https://... without trailing slashes.
const normalizeUrl = (value) => {
  const url = String(value ?? "").trim().replace(/\/+$/, "");
  if (!url) return "";
  if (url.length > MAX_URL_LENGTH || !/^https?:\/\/[^\s/]+/i.test(url)) {
    throw createHttpError(400, "URL API harus diawali http:// atau https://.");
  }
  return url;
};

// apiKey: a new key; null removes it; undefined keeps the saved one.
const normalizeKey = (value) => {
  if (value === undefined || value === null) return value;
  const key = String(value).trim();
  if (!key) return undefined;
  if (key.length > MAX_KEY_LENGTH) throw createHttpError(400, "API key terlalu panjang.");
  return key;
};

const update = async (code, { baseUrl, apiKey, isActive }, userId) => {
  assertCode(code);
  const url = normalizeUrl(baseUrl);
  const key = normalizeKey(apiKey);
  const active = isActive !== false;
  const saved = await repository.findByCode(LOYALTY);
  if (active && key !== null && !url) throw createHttpError(400, "URL API wajib diisi.");
  if (active && key === undefined && !saved?.api_key_sealed) throw createHttpError(400, "API key wajib diisi.");

  await repository.upsert(LOYALTY, {
    baseUrl: url,
    apiKeySealed: key === undefined ? undefined : key === null ? null : seal(key),
    apiKeyHint: key ? key.slice(-4) : null,
    isActive: active,
    updatedBy: userId,
  });
  forgetCache();
  return toView(await repository.findByCode(LOYALTY));
};

// Tes koneksi: the values typed (a key left empty: the saved one) against
// the loyalty app's GET /program. { ok, message }.
const test = async (code, { baseUrl, apiKey } = {}, { request } = {}) => {
  assertCode(code);
  const saved = await repository.findByCode(LOYALTY);
  const apiUrl = normalizeUrl(baseUrl ?? saved?.base_url);
  const apiToken = normalizeKey(apiKey) || (saved?.api_key_sealed ? open(saved.api_key_sealed) : "");
  if (!apiUrl || !apiToken) return { ok: false, message: "Isi URL API dan API key dulu." };

  const client = require("../loyalty/loyalty.client");
  try {
    const { data } = await (request || client.request)("GET", "/program", undefined, {
      connection: { apiUrl, apiToken },
    });
    return { ok: true, message: `Tersambung: ${data?.name || "Loyalty"}.` };
  } catch (error) {
    return { ok: false, message: `Tidak tersambung: ${error.message}` };
  }
};

module.exports = { forgetCache, isLoyaltyEnabled, list, loyaltyConnection, test, update };
