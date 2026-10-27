// Request/seed normalizers for a menu item's recipe and price row.

// Recipe quantities are stored as plain numbers (shown as 8, 0.015); rounding
// to 4 decimals keeps float noise like 0.30000000000000004 out of the table.
const roundRecipeQuantity = (value) =>
  Math.round((Number(value) || 0) * 10000) / 10000;

const normalizeIngredient = (ingredient) => ({
  stockItemId: Number(ingredient?.stockItemId || ingredient?.stock_item_id) || null,
  quantity: roundRecipeQuantity(ingredient?.quantity),
  note: String(ingredient?.note || "").trim(),
});

// Recipe rows must point at a stock item; quantities are in the stock item's
// unit. The recipes table allows one row per stock item, so repeats are summed.
const normalizeIngredients = (ingredients) => {
  const ingredientsByStockItemId = new Map();

  (Array.isArray(ingredients) ? ingredients : [])
    .map(normalizeIngredient)
    .filter((ingredient) => ingredient.stockItemId > 0 && ingredient.quantity >= 0)
    .forEach((ingredient) => {
      const existing = ingredientsByStockItemId.get(ingredient.stockItemId);

      if (existing) {
        existing.quantity = roundRecipeQuantity(existing.quantity + ingredient.quantity);
      } else {
        ingredientsByStockItemId.set(ingredient.stockItemId, ingredient);
      }
    });

  return [...ingredientsByStockItemId.values()];
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
