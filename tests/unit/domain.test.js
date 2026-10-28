const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { buildMenuItemRecord } = require("../../src/modules/menu/menu.pricing");
const { getSourceMenuItemId, toRecipeLines } = require("../../src/modules/orders/order.items");
const { normalizeOrderDateInput } = require("../../src/modules/orders/order.validation");
const {
  createThermalPrintJob,
  getThermalPrintJob,
  toBluetoothPrintResponse,
} = require("../../src/modules/orders/thermalPrint.store");
const { normalizePayload, validatePayload } = require("../../src/modules/recaps/recap.payload");
const { convertQuantity, normalizePurchase } = require("../../src/modules/shopping/shopping.validation");

describe("menu pricing", () => {
  it("derives gross profit from price and HPP for single-price items", () => {
    const record = buildMenuItemRecord({ price: 15000, hpp: 5000 });
    assert.equal(record.basePrice, 15000);
    assert.deepEqual(record.profitFields, { hppCost: 5000, grossProfit: 10000 });
  });

  it("stores zero HPP/profit when no financial input is sent", () => {
    assert.deepEqual(buildMenuItemRecord({ price: 1000 }).profitFields, {
      hppCost: 0,
      grossProfit: 0,
    });
  });

  it("keeps one recipe row per stock item, summing repeats", () => {
    const record = buildMenuItemRecord({
      price: 1,
      ingredients: [
        { stockItemId: 4, quantity: 10 },
        { stock_item_id: "4", quantity: 5, note: "ekstra" },
        { ingredientName: "no stock", quantity: 1 },
        { stockItemId: 7, quantity: 0.1 },
        { stockItemId: 7, quantity: "0.2" },
        { stockItemId: 8, quantity: 0.123456 },
        // A semi item with the same id as a raw item is a different row.
        { semiItemId: 4, quantity: 1 },
        { semiItemId: "4", stockItemId: 9, quantity: 2 },
      ],
    });
    assert.deepEqual(record.normalizedIngredients, [
      { stockItemId: 4, semiItemId: null, quantity: 15, note: "" },
      { stockItemId: 7, semiItemId: null, quantity: 0.3, note: "" },
      { stockItemId: 8, semiItemId: null, quantity: 0.1235, note: "" },
      { stockItemId: null, semiItemId: 4, quantity: 3, note: "" },
    ]);
  });

  it("keeps the online price only when the item is on online platforms", () => {
    assert.equal(buildMenuItemRecord({ price: 1, onlinePrice: 5 }).baseOnlinePrice, null);
    assert.equal(
      buildMenuItemRecord({ price: 1, includeOnlinePlatform: true, onlinePrice: "5" }).baseOnlinePrice,
      5
    );
  });
});

describe("order items", () => {
  it("resolves the source menu item from legacy cart shapes", () => {
    assert.equal(getSourceMenuItemId({ sourceMenuItemId: "9" }), 9);
    assert.equal(getSourceMenuItemId({ menuItemId: 4 }), 4);
    assert.equal(getSourceMenuItemId({ id: "3-12-Regular" }), 12);
    assert.equal(getSourceMenuItemId({ id: "abc" }), null);
  });

  it("builds recipe lines, dropping zero quantities and unknown items", () => {
    assert.deepEqual(
      toRecipeLines([
        { sourceMenuItemId: 2, quantity: "2" },
        { sourceMenuItemId: 3, quantity: 0 },
        { name: "no id", quantity: 1 },
      ]),
      [{ menuItemId: 2, quantity: 2 }]
    );
    assert.deepEqual(toRecipeLines(null), []);
  });

  it("validates online order dates as real calendar days", () => {
    assert.equal(normalizeOrderDateInput(""), null);
    assert.equal(normalizeOrderDateInput("2026-01-15"), "2026-01-15");
    assert.throws(() => normalizeOrderDateInput("2026-02-30"), { statusCode: 400 });
    assert.throws(() => normalizeOrderDateInput("15/01/2026"), { statusCode: 400 });
  });
});

describe("thermal print store", () => {
  it("returns a job only for the order it was created for", () => {
    const token = createThermalPrintJob({ orderId: "5", payload: [{ content: "x" }], userId: 1 });
    assert.ok(getThermalPrintJob({ orderId: 5, token }));
    assert.equal(getThermalPrintJob({ orderId: 6, token }), null);
    assert.equal(getThermalPrintJob({ orderId: 5, token: "unknown" }), null);
  });

  it("rejects empty or oversized payloads", () => {
    assert.throws(() => createThermalPrintJob({ orderId: 1, payload: [] }), { statusCode: 400 });
    assert.throws(
      () => createThermalPrintJob({ orderId: 1, payload: Array.from({ length: 201 }, () => ({})) }),
      { statusCode: 413 }
    );
  });

  it("renders the RawBT index-keyed object", () => {
    assert.deepEqual(toBluetoothPrintResponse(["a", "b"]), { 0: "a", 1: "b" });
  });
});

describe("recap payloads", () => {
  it("derives daily totals when the client omits them", () => {
    const data = normalizePayload(
      "daily",
      { recapDate: "2026-09-15T10:00:00Z", offlineRevenue: 100, onlineRevenue: 50, hppTotal: 30, cashIn: 120 },
      7
    );
    assert.equal(data.recapDate, "2026-09-15");
    assert.equal(data.totalRevenue, 150);
    assert.equal(data.grossProfit, 120);
    assert.equal(data.cashDifference, -30);
    assert.equal(data.createdBy, 7);
  });

  it("expands a monthly period to the full calendar month", () => {
    const data = normalizePayload("monthly", { periodMonth: "2026-02-15" }, null);
    assert.equal(data.periodMonth, "2026-02");
    assert.equal(data.periodStartDate, "2026-02-01");
    assert.equal(data.periodEndDate, "2026-02-28");
  });

  it("reports missing periods per type", () => {
    assert.equal(validatePayload("daily", normalizePayload("daily", {}, null)), "Tanggal recap wajib diisi!");
    assert.equal(validatePayload("weekly", normalizePayload("weekly", {}, null)), "Periode mingguan wajib diisi!");
    assert.equal(validatePayload("monthly", normalizePayload("monthly", {}, null)), "Periode bulanan wajib diisi!");
  });
});

describe("shopping validation", () => {
  it("converts purchase units strictly", () => {
    assert.equal(convertQuantity(1.5, "kg", "gr"), 1500);
    assert.throws(() => convertQuantity(1, "pcs", "kg"), { status: 400 });
    assert.throws(() => convertQuantity(0.001, "gr", "kg"), { status: 400 });
  });

  it("requires a valid request id and calendar date", () => {
    const base = {
      requestId: "aaaaaaaaaaaaaaaa",
      date: "2026-09-15",
      suplierName: "Toko",
      paymentMethod: "Cash",
      items: [{ itemName: "Gula", quantity: 1, unit: "KG", unitPrice: 1000 }],
    };
    const purchase = normalizePurchase(base);
    assert.equal(purchase.items[0].unit, "kg");
    assert.throws(() => normalizePurchase({ ...base, requestId: "short" }), { status: 400 });
    assert.throws(() => normalizePurchase({ ...base, date: "2026-02-30" }), { status: 400 });
    assert.throws(() => normalizePurchase({ ...base, suplierId: 1 }), { status: 400 });
  });
});
