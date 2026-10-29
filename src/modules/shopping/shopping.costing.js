// Harga modal rata-rata bergerak (moving average cost) when a posted nota
// brings stock in:
//
//   Harga Satuan Baru = ((Stok Lama × Harga Modal Lama) + Nilai Masuk)
//                       / (Stok Lama + Stok Masuk)
//
// e.g. Gula 2.000 g at Rp 15 (Rp 30.000) + 1.000 g for Rp 18.000
//      = Rp 48.000 / 3.000 g = Rp 16/g, used by the next sale right away.
//
// Nilai Masuk is the line's cost_total: its amount plus its share of ongkir
// and PPN, minus diskon (shopping.totals). Stock below zero (sold before it
// was bought) counts with its negative value, so the purchase first covers
// the units already sold. When nothing is left on hand, or the old value
// would make the cost negative, the new cost is this purchase's own price.
const { roundCost, roundCurrency } = require("../../shared/utils/money");

const receiveIntoStock = ({ stock, stockValue, unitCost }, quantity, cost) => {
  const oldStock = Number(stock || 0);
  const oldCost = Number(unitCost || 0);
  // stock_value keeps the exact amount (unit_cost is whole rupiah); older
  // rows may only have the unit cost.
  const oldValue = oldStock > 0
    ? Math.max(Number(stockValue || 0), roundCurrency(oldStock * oldCost))
    : roundCurrency(oldStock * oldCost);
  const nextStock = Math.round((oldStock + Number(quantity)) * 100) / 100;
  const nextValue = roundCurrency(oldValue + Number(cost));

  if (nextStock > 0 && nextValue >= 0) {
    return { stock: nextStock, stockValue: nextValue, unitCost: roundCost(nextValue / nextStock) };
  }

  const purchasePrice = Number(quantity) > 0 ? Number(cost) / Number(quantity) : oldCost;
  return {
    stock: nextStock,
    stockValue: nextStock > 0 ? roundCurrency(nextStock * purchasePrice) : 0,
    unitCost: roundCost(purchasePrice),
  };
};

module.exports = { receiveIntoStock };
