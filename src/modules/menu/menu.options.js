// Request/seed normalizers for a menu item's recipe and price row.

// Recipe quantities are stored as plain numbers (shown as 8, 0.015); rounding
// to 4 decimals keeps float noise like 0.30000000000000004 out of the table.
const roundRecipeQuantity = (value) =>
  Math.round((Number(value) || 0) * 10000) / 10000;

// An ingredient is a bahan setengah jadi when semiItemId is set, otherwise a
// bahan baku (stockItemId).
const normalizeIngredient = (ingredient) => {
  const semiItemId = Number(ingredient?.semiItemId || ingredient?.semi_item_id) || null;

  return {
    stockItemId: semiItemId
      ? null
      : Number(ingredient?.stockItemId || ingredient?.stock_item_id) || null,
    semiItemId,
    quantity: roundRecipeQuantity(ingredient?.quantity),
    note: String(ingredient?.note || "").trim(),
  };
};

// Recipe rows must point at a stock item; quantities are in that item's unit.
// The recipes table allows one row per item, so repeats are summed.
const normalizeIngredients = (ingredients) => {
  const ingredientsByItemKey = new Map();

  (Array.isArray(ingredients) ? ingredients : [])
    .map(normalizeIngredient)
    .filter(
      (ingredient) =>
        (ingredient.stockItemId > 0 || ingredient.semiItemId > 0) && ingredient.quantity >= 0
    )
    .forEach((ingredient) => {
      const key = ingredient.semiItemId
        ? `semi:${ingredient.semiItemId}`
        : `raw:${ingredient.stockItemId}`;
      const existing = ingredientsByItemKey.get(key);

      if (existing) {
        existing.quantity = roundRecipeQuantity(existing.quantity + ingredient.quantity);
      } else {
        ingredientsByItemKey.set(key, ingredient);
      }
    });

  return [...ingredientsByItemKey.values()];
};

const PRICE_ROW_COLUMNS =
  "(menu_item_id, regular_price, online_price, hpp_cost, gross_profit)";

// The menu_item_prices row of a menu item, or null when it has no price.
const toPriceRow = (
  menuItemId,
  { regularPrice, onlinePrice, hppCost, grossProfit }
) =>
  regularPrice === null || regularPrice === undefined
    ? null
    : [menuItemId, regularPrice, onlinePrice ?? null, hppCost ?? 0, grossProfit ?? 0];

module.exports = {
  PRICE_ROW_COLUMNS,
  normalizeIngredients,
  roundRecipeQuantity,
  toPriceRow,
};
