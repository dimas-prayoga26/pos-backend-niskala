const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { toTitleName } = require("../../src/shared/utils/names");

// Pairs shared with the SQL script check (scripts/rapikan-nama-bahan.sql).
const CASES = [
  ["CABE MERAH BESAR", "Cabe Merah Besar"],
  ["cabe   rawit ", "Cabe Rawit"],
  ["Bawang Bombay", "Bawang Bombay"],
  ["Jus jeruk", "Jus Jeruk"],
  ["COCA-COLA", "Coca-Cola"],
  ["CLEO 200 ML", "Cleo 200 ml"],
  ["GULA KG UJI", "Gula Kg Uji"],
  ["SUSU 1,5 LTR", "Susu 1,5 ltr"],
  ["Aqua 600ml", "Aqua 600ml"],
  ["Greenfields UHT 1L", "Greenfields UHT 1L"],
  ["skm", "SKM"],
  ["POWDER COOKIES AND CREAM", "Powder Cookies and Cream"],
  ["AND MORE", "And More"],
  ["Cup 16 oz + tutup", "Cup 16 oz + Tutup"],
  ["MilkLife SUSU", "MilkLife Susu"],
  ["SAUS (PEDAS)", "Saus (Pedas)"],
  ["FOOD TRAY M", "Food Tray M"],
  ["", ""],
];

describe("toTitleName", () => {
  for (const [input, expected] of CASES) {
    it(`${JSON.stringify(input)} -> ${JSON.stringify(expected)}`, () => {
      assert.equal(toTitleName(input), expected);
    });
  }

  it("leaves a Title Case name as it is", () => {
    for (const [, expected] of CASES) assert.equal(toTitleName(expected), expected);
  });

  it("is applied to a new bahan baku typed on a Belanja nota", () => {
    const { normalizePurchase } = require("../../src/modules/shopping/shopping.validation");
    const nota = normalizePurchase({
      requestId: "names-test-0000001",
      date: "2026-11-11",
      suplierName: "Toko Uji",
      paymentMethod: "Cash",
      items: [{ itemName: "gula PASIR uji", quantity: 1, unit: "kg", unitPrice: 15000 }, { stockItemId: 3, quantity: 1, unit: "gr", unitPrice: 1 }],
    });
    assert.equal(nota.items[0].itemName, "Gula Pasir Uji");
    assert.equal(nota.items[1].itemName, undefined);
  });
});

module.exports = { CASES };
