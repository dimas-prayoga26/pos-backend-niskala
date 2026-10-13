// Pricing rules shared by menu create and update.
// Items with sizes keep their prices/HPP per size, so base price and HPP are null.
const { parseNumber } = require("../../shared/utils/money");
const { normalizeIngredients, normalizeSizes } = require("./menu.options");

const parseNullableNumber = (value) => {
  if (value === undefined || value === null || value === "") return null;

  const numericValue = Number(value);

  return Number.isFinite(numericValue) ? numericValue : null;
};

const buildProfitFields = ({
  price,
  hppCost,
  grossProfit,
}) => {
  const hasFinancialInput =
    hppCost !== undefined || grossProfit !== undefined;

  if (!hasFinancialInput) {
    return {
      hppCost: 0,
      grossProfit: 0,
    };
  }

  const normalizedPrice = parseNumber(price);
  const normalizedHppCost = parseNumber(hppCost);
  const calculatedGrossProfit =
    grossProfit === undefined
      ? normalizedPrice - normalizedHppCost
      : parseNumber(grossProfit);

  return {
    hppCost: normalizedHppCost,
    grossProfit: calculatedGrossProfit,
  };
};

const buildMenuItemRecord = ({
  price,
  regularPrice,
  includeOnlinePlatform,
  onlinePrice,
  hppCost,
  hpp,
  grossProfit,
  profit,
  ingredients = [],
  sizes = [],
}) => {
  const normalizedSizes = normalizeSizes(sizes);
  const normalizedIngredients = normalizeIngredients(ingredients);
  const basePrice =
    normalizedSizes.length > 0
      ? null
      : regularPrice === undefined
        ? price
        : regularPrice;
  const shouldIncludeOnlinePlatform =
    normalizedSizes.length === 0 && Boolean(includeOnlinePlatform);
  const baseOnlinePrice = shouldIncludeOnlinePlatform
    ? parseNullableNumber(onlinePrice)
    : null;
  const profitFields = normalizedSizes.length
    ? { hppCost: null, grossProfit: null }
    : buildProfitFields({
        price: basePrice,
        hppCost: hppCost ?? hpp,
        grossProfit: grossProfit ?? profit,
      });

  return {
    basePrice,
    baseOnlinePrice,
    shouldIncludeOnlinePlatform,
    profitFields,
    normalizedSizes,
    normalizedIngredients,
  };
};

module.exports = { buildMenuItemRecord };
