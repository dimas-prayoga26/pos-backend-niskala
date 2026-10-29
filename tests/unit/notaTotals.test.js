const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { computeNotaTotals } = require("../../src/modules/shopping/shopping.totals");

describe("computeNotaTotals (Ringkasan nota)", () => {
  it("applies diskon %, PPN on the discounted subtotal and ongkir, and spreads them over the lines", () => {
    assert.deepEqual(
      computeNotaTotals([100000, 50000], { shippingCost: 15000, discountType: "percent", discountValue: 10, taxPercent: 11 }),
      {
        subtotal: 150000,
        discountAmount: 15000,
        taxAmount: 14850,
        shippingCost: 15000,
        total: 164850,
        costTotals: [109900, 54950],
      }
    );
  });

  it("caps a diskon in rupiah at the subtotal", () => {
    const totals = computeNotaTotals([1000], { discountType: "amount", discountValue: 5000 });
    assert.deepEqual([totals.discountAmount, totals.total, totals.costTotals], [1000, 0, [0]]);
  });

  it("gives rounding leftovers to the largest line so the costs add up to the grand total", () => {
    assert.deepEqual(computeNotaTotals([1, 1, 1], { shippingCost: 1 }).costTotals, [1.34, 1.33, 1.33]);
    assert.deepEqual(computeNotaTotals([10, 30.5], { shippingCost: 0.03 }).costTotals, [10.01, 30.52]);
  });

  it("shares ongkir equally among lines of Rp 0 and leaves a nota without footer unchanged", () => {
    assert.deepEqual(computeNotaTotals([0, 0], { shippingCost: 1001 }).costTotals, [500.5, 500.5]);
    const plain = computeNotaTotals([1500.5, 2000]);
    assert.deepEqual([plain.total, plain.costTotals], [3500.5, [1500.5, 2000]]);
  });
});
