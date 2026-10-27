// Pricing rules shared by menu create and update.
const { parseNumber } = require("../../shared/utils/money");
const { normalizeIngredients } = require("./menu.options");

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
}) => {
  const basePrice = regularPrice === undefined ? price : regularPrice;
  const shouldIncludeOnlinePlatform = Boolean(includeOnlinePlatform);
  const baseOnlinePrice = shouldIncludeOnlinePlatform
    ? parseNullableNumber(onlinePrice)
    : null;
  const profitFields = buildProfitFields({
    price: basePrice,
    hppCost: hppCost ?? hpp,
    grossProfit: grossProfit ?? profit,
  });

  return {
    basePrice,
    baseOnlinePrice,
    shouldIncludeOnlinePlatform,
    profitFields,
    normalizedIngredients: normalizeIngredients(ingredients),
  };
};

module.exports = { buildMenuItemRecord };
