// Footer of a nota: Subtotal (the item lines), Diskon Nota (Rp or %), PPN on
// the discounted subtotal, Ongkos Kirim, and the Grand Total that leaves the
// payment source. The difference between the Grand Total and the Subtotal is
// spread over the lines in proportion to their amount, so each line's
// cost_total (what enters stock and COGS) includes its share of ongkir,
// diskon and PPN. The frontend mirrors this in utils/notaTotals.js.
const NO_ADJUSTMENTS = { shippingCost: 0, discountType: "amount", discountValue: 0, taxPercent: 0 };

const cents = (value) => Math.round(Number(value || 0) * 100);
const sum = (values) => values.reduce((total, value) => total + value, 0);

const computeNotaTotals = (lineTotals, adjustments = NO_ADJUSTMENTS) => {
  const { shippingCost = 0, discountType = "amount", discountValue = 0, taxPercent = 0 } = adjustments;
  const lines = lineTotals.map(cents);
  const subtotal = sum(lines);
  const discount = Math.min(
    discountType === "percent" ? Math.round((subtotal * Number(discountValue || 0)) / 100) : cents(discountValue),
    subtotal
  );
  const tax = Math.round(((subtotal - discount) * Number(taxPercent || 0)) / 100);
  const shipping = cents(shippingCost);
  const total = subtotal - discount + tax + shipping;

  // Lines of Rp 0 only (e.g. free samples) share the adjustment equally.
  const weights = subtotal > 0 ? lines : lines.map(() => 1);
  const weightTotal = sum(weights);
  const costs = lines.map((line, index) =>
    weightTotal ? line + Math.round(((total - subtotal) * weights[index]) / weightTotal) : line
  );
  if (costs.length) {
    // Rounding leftovers go to the largest line so the costs add up exactly.
    const largest = weights.indexOf(Math.max(...weights));
    costs[largest] += total - sum(costs);
  }

  return {
    subtotal: subtotal / 100,
    discountAmount: discount / 100,
    taxAmount: tax / 100,
    shippingCost: shipping / 100,
    total: total / 100,
    costTotals: costs.map((cost) => cost / 100),
  };
};

// The adjustments stored on a nota header row.
const adjustmentsFromHeader = (row) => ({
  shippingCost: Number(row.shipping_cost || 0),
  discountType: row.discount_type === "percent" ? "percent" : "amount",
  discountValue: Number(row.discount_value || 0),
  taxPercent: Number(row.tax_percent || 0),
});

module.exports = { NO_ADJUSTMENTS, adjustmentsFromHeader, computeNotaTotals };
