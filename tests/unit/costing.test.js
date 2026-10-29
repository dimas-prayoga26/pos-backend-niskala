const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { receiveIntoStock } = require("../../src/modules/shopping/shopping.costing");

describe("receiveIntoStock (moving average cost when a nota is posted)", () => {
  it("follows the formula: Gula 2.000 g at Rp 15 + 1.000 g for Rp 18.000 = Rp 16/g", () => {
    assert.deepEqual(
      receiveIntoStock({ stock: 2000, stockValue: 30000, unitCost: 15 }, 1000, 18000),
      { stock: 3000, stockValue: 48000, unitCost: 16 }
    );
  });

  it("starts from the purchase price when there was no stock, and uses the unit cost of rows without a stock value", () => {
    assert.deepEqual(receiveIntoStock({ stock: 0, stockValue: 0, unitCost: 0 }, 1500, 150000), {
      stock: 1500,
      stockValue: 150000,
      unitCost: 100,
    });
    assert.deepEqual(receiveIntoStock({ stock: 100, stockValue: 0, unitCost: 50 }, 100, 6000), {
      stock: 200,
      stockValue: 11000,
      unitCost: 55,
    });
  });

  it("covers stock sold below zero first (FRESHMILK -2.000 ml at Rp 20)", () => {
    // (-2.000 x 20 + 59.100) / 1.000 = Rp 19,1 -> Rp 19/ml
    assert.deepEqual(receiveIntoStock({ stock: -2000, stockValue: 0, unitCost: 20 }, 3000, 59100), {
      stock: 1000,
      stockValue: 19100,
      unitCost: 19,
    });
    // Still below zero: nothing on hand, the cost becomes the new purchase price.
    assert.deepEqual(receiveIntoStock({ stock: -2000, stockValue: 0, unitCost: 20 }, 1000, 19700), {
      stock: -1000,
      stockValue: 0,
      unitCost: 20,
    });
  });

  it("never gives a negative cost when the old cost was far above the new price", () => {
    assert.deepEqual(receiveIntoStock({ stock: -500, stockValue: 0, unitCost: 30 }, 1000, 5000), {
      stock: 500,
      stockValue: 2500,
      unitCost: 5,
    });
  });
});
