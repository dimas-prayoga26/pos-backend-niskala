// Cart items reference their menu item in several legacy shapes; this resolves
// the source menu item id and the recipe lines used for stock movements.
const getSourceMenuItemId = (item) => {
  const directId = Number(
    item.sourceMenuItemId || item.menuItemSourceId || item.menuId
  );

  if (Number.isFinite(directId) && directId > 0) return directId;

  const menuItemId = Number(item.menuItemId);
  if (Number.isFinite(menuItemId) && menuItemId > 0) return menuItemId;

  const [categoryId, parsedMenuItemId] = String(item.id || "")
    .split("-")
    .map(Number);

  if (
    Number.isFinite(categoryId) &&
    Number.isFinite(parsedMenuItemId) &&
    parsedMenuItemId > 0
  ) {
    return parsedMenuItemId;
  }

  return null;
};

// bundleChoices: the menus picked for one package (already checked).
const pickedBundleChoices = (item) => {
  const choices = (item.bundleChoices || []).filter(
    (choice) => Number(choice.menuItemId) > 0 && Number(choice.quantity) > 0
  );
  return choices.length ? { bundleChoices: choices } : {};
};

// ingredientSwaps: bahan olahan swapped in this item (already checked).
const pickedIngredientSwaps = (item) => {
  const swaps = (item.ingredientSwaps || []).filter(
    (swap) => Number(swap.fromSemiItemId) > 0 && Number(swap.toSemiItemId) > 0
  );
  return swaps.length ? { ingredientSwaps: swaps } : {};
};

const normalizeOrderItemsForStock = (items = []) =>
  items
    .map((item) => ({
      menuItemId: getSourceMenuItemId(item),
      quantity: Math.max(Number(item.quantity) || 0, 0),
      ...pickedBundleChoices(item),
      ...pickedIngredientSwaps(item),
    }))
    .filter((item) => item.menuItemId && item.quantity > 0);

const toRecipeLines = (items) => (items ? normalizeOrderItemsForStock(items) : []);

module.exports = { getSourceMenuItemId, toRecipeLines };
