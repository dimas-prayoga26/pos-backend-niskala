// Unit families and their factor to the family's base unit (g, ml, pcs).
const UNIT_CONVERSIONS = {
  kg: ["mass", 1000],
  gr: ["mass", 1],
  g: ["mass", 1],
  gram: ["mass", 1],
  l: ["volume", 1000],
  liter: ["volume", 1000],
  litre: ["volume", 1000],
  ml: ["volume", 1],
  pcs: ["pieces", 1],
  pc: ["pieces", 1],
  buah: ["pieces", 1],
};

const areConvertible = (fromUnit, toUnit) =>
  Boolean(UNIT_CONVERSIONS[fromUnit]) &&
  Boolean(UNIT_CONVERSIONS[toUnit]) &&
  UNIT_CONVERSIONS[fromUnit][0] === UNIT_CONVERSIONS[toUnit][0];

const convertBetweenUnits = (qty, fromUnit, toUnit) =>
  (qty * UNIT_CONVERSIONS[fromUnit][1]) / UNIT_CONVERSIONS[toUnit][1];

// Lenient conversion for recipes: unknown or incompatible units fall back to
// the raw quantity instead of failing (used for order stock and HPP).
const convertRecipeQuantity = (qty, from, to) => {
  const fromUnit = String(from || "").trim().toLowerCase();
  const toUnit = String(to || "").trim().toLowerCase();
  const quantity = Number(qty) || 0;

  if (!fromUnit || !toUnit || fromUnit === toUnit) return quantity;
  if (!areConvertible(fromUnit, toUnit)) return quantity;

  return convertBetweenUnits(quantity, fromUnit, toUnit);
};

module.exports = {
  UNIT_CONVERSIONS,
  areConvertible,
  convertBetweenUnits,
  convertRecipeQuantity,
};
