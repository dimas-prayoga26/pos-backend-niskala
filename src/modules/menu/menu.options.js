// Request/seed normalizers for menu sizes, temperature variants and recipes.
const normalizeSize = (size) => ({
  name: String(size?.name || "").trim(),
  price: Number(size?.price) || 0,
  hppCost: Number(size?.hppCost ?? size?.hpp_cost) || 0,
  grossProfit: Number(size?.grossProfit ?? size?.gross_profit) || 0,
});

const normalizeSizes = (sizes) =>
  (Array.isArray(sizes) ? sizes : [])
    .map(normalizeSize)
    .filter((size) => size.name && size.price >= 0);

const normalizeVariants = (variants) =>
  (Array.isArray(variants) ? variants : [])
    .map((variant) => String(variant || "").trim())
    .filter(Boolean);

const normalizeIngredient = (ingredient) => ({
  stockItemId: ingredient?.stockItemId || ingredient?.stock_item_id || null,
  sizeName: String(ingredient?.sizeName || ingredient?.size_name || "").trim(),
  ingredientName: String(
    ingredient?.ingredientName || ingredient?.ingredient_name || ingredient?.name || ""
  ).trim(),
  quantity: Number(ingredient?.quantity) || 0,
  unit: String(ingredient?.unit || "").trim(),
  note: String(ingredient?.note || "").trim(),
});

const normalizeIngredients = (ingredients) =>
  (Array.isArray(ingredients) ? ingredients : [])
    .map(normalizeIngredient)
    .filter(
      (ingredient) =>
        ingredient.ingredientName &&
        ingredient.quantity >= 0 &&
        ingredient.unit
    );

module.exports = {
  normalizeIngredients,
  normalizeSizes,
  normalizeVariants,
};
