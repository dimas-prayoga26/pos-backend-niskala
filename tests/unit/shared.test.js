const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { parseNominal, parseNumber, roundCost, roundCurrency } = require("../../src/shared/utils/money");
const { formatMonthlyOrderCode } = require("../../src/shared/utils/orderCode");
const { areConvertible, convertRecipeQuantity } = require("../../src/shared/utils/units");
const { requireRole } = require("../../src/shared/middleware/authorize");
const { requireNumericId } = require("../../src/shared/middleware/validateParams");

const runMiddleware = (middleware, req) => {
  let forwarded;
  middleware(req, {}, (error) => {
    forwarded = error ?? null;
  });
  return forwarded;
};

describe("money", () => {
  it("rounds currency to 2 decimals and cost to 4", () => {
    assert.equal(roundCurrency(10.005), 10.01);
    assert.equal(roundCurrency("abc"), 0);
    assert.equal(roundCost(103.448275), 103);
    assert.equal(roundCost(72.75), 73);
  });

  it("parses formatted nominal strings by keeping digits only", () => {
    assert.equal(parseNominal("Rp 4.500"), 4500);
    assert.equal(parseNominal(""), 0);
    assert.equal(parseNominal(1250.5), 1250.5);
    assert.equal(parseNominal(null), 0);
  });

  it("falls back for non-finite numbers", () => {
    assert.equal(parseNumber("12.5"), 12.5);
    assert.equal(parseNumber("x", 7), 7);
    assert.ok(Number.isNaN(parseNumber(undefined, NaN)));
  });
});

describe("order code", () => {
  it("formats YYMM-NNNN", () => {
    assert.equal(formatMonthlyOrderCode({ sequence: 7, month: "1", year: "26" }), "2601-0007");
  });
});

describe("recipe unit conversion (lenient)", () => {
  it("converts within a unit family", () => {
    assert.equal(convertRecipeQuantity(18, "gr", "kg"), 0.018);
    assert.equal(convertRecipeQuantity(0.5, " Liter ", "ml"), 500);
    assert.equal(convertRecipeQuantity(2, "pc", "buah"), 2);
  });

  it("falls back to the raw quantity for unknown, blank or incompatible units", () => {
    assert.equal(convertRecipeQuantity(3, "sachet", "gr"), 3);
    assert.equal(convertRecipeQuantity(3, "", "gr"), 3);
    assert.equal(convertRecipeQuantity(3, "pcs", "ml"), 3);
    assert.equal(convertRecipeQuantity("x", "kg", "g"), 0);
  });

  it("reports convertibility by family", () => {
    assert.equal(areConvertible("kg", "gram"), true);
    assert.equal(areConvertible("kg", "ml"), false);
    assert.equal(areConvertible("sachet", "sachet"), false);
  });
});

describe("authorization middleware", () => {
  it("compares roles case-insensitively and forwards a 403 with the given message", () => {
    const adminOnly = requireRole("admin", "Only admin!");
    assert.equal(runMiddleware(adminOnly, { user: { role: "Admin" } }), null);

    const error = runMiddleware(adminOnly, { user: { role: "Cashier" } });
    assert.equal(error.statusCode, 403);
    assert.equal(error.message, "Only admin!");
    assert.equal(runMiddleware(adminOnly, {}).statusCode, 403);
  });

  it("accepts any role in a list", () => {
    const staff = requireRole(["admin", "cashier"], "Staff only");
    assert.equal(runMiddleware(staff, { user: { role: "CASHIER" } }), null);
  });

  it("rejects non-numeric or zero ids with the configured status", () => {
    const validId = requireNumericId();
    assert.equal(runMiddleware(validId, { params: { id: "12" } }), null);
    assert.equal(runMiddleware(validId, { params: { id: "abc" } }).statusCode, 404);
    assert.equal(runMiddleware(validId, { params: { id: "0" } }).message, "Invalid id!");

    const recapId = requireNumericId({ status: 400, message: "Rekap harian tidak valid." });
    assert.equal(runMiddleware(recapId, { params: { id: "x" } }).statusCode, 400);
  });
});
