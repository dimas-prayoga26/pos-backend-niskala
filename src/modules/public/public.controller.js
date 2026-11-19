const crypto = require("node:crypto");
const createHttpError = require("http-errors");
const config = require("../../config/env");
const asyncHandler = require("../../shared/http/asyncHandler");
const bestDrinksService = require("./bestDrinks.service");

const MAX_LIMIT = 20;
const MAX_DAYS = 3650;

const digest = (value) => crypto.createHash("sha256").update(String(value)).digest();

// PUBLIC_API_KEY set: only callers with that X-API-Key get through.
const requirePublicApiKey = (req, res, next) => {
  const expected = config.publicApi.key;
  if (!expected) return next();

  const given = req.get("x-api-key") || "";
  if (given && crypto.timingSafeEqual(digest(given), digest(expected))) return next();

  return next(createHttpError(401, "API key tidak valid."));
};

// Where image URLs point: PUBLIC_BASE_URL, else the address the request
// came in on (https behind the hosting's proxy).
const baseUrlOf = (req) => {
  if (config.publicApi.baseUrl) return config.publicApi.baseUrl;
  const forwardedProto = String(req.get("x-forwarded-proto") || "").split(",")[0].trim();
  return `${forwardedProto || req.protocol}://${req.get("host")}`;
};

// A whole number from 1 to max, the fallback when absent, NaN when invalid.
const queryNumber = (value, fallback, max) => {
  if (value === undefined || value === "") return fallback;
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= max ? number : NaN;
};

// GET /api/public/best-drinks[?limit=4][&days=30]
// limit: how many (1-20, default 4); days: sales of the last n days
// (default: all sales, like Best Seller on the POS Home).
const getBestDrinks = asyncHandler(async (req, res, next) => {
  const limit = queryNumber(req.query.limit, 4, MAX_LIMIT);
  const days = queryNumber(req.query.days, null, MAX_DAYS);

  if (Number.isNaN(limit)) return next(createHttpError(400, `limit harus angka 1-${MAX_LIMIT}.`));
  if (Number.isNaN(days)) return next(createHttpError(400, `days harus angka 1-${MAX_DAYS}.`));

  const menus = await bestDrinksService.listBestDrinks({ limit, days, baseUrl: baseUrlOf(req) });

  res.set("Cache-Control", "public, max-age=300");
  res.status(200).json({ success: true, data: menus });
});

module.exports = { getBestDrinks, requirePublicApiKey };
