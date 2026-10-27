const roundCurrency = (value) => Math.round((Number(value) || 0) * 100) / 100;

// Unit costs (unit_cost) are whole rupiah; stock_value keeps the exact amount.
const roundCost = (value) => Math.round(Number(value) || 0);

// Accepts formatted nominal strings such as "Rp 4.500" by keeping digits only.
const parseNominal = (value) => {
  if (typeof value === "string") {
    const digitsOnly = value.replace(/\D/g, "");

    return Number(digitsOnly) || 0;
  }

  return Number(value) || 0;
};

const parseNumber = (value, fallback = 0) => {
  const numericValue = Number(value);

  return Number.isFinite(numericValue) ? numericValue : fallback;
};

module.exports = { parseNominal, parseNumber, roundCost, roundCurrency };
