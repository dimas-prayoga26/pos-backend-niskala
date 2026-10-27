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

const normalizeOrderItemsForStock = (items = []) =>
  items
    .map((item) => ({
      menuItemId: getSourceMenuItemId(item),
      quantity: Math.max(Number(item.quantity) || 0, 0),
    }))
    .filter((item) => item.menuItemId && item.quantity > 0);

const toRecipeLines = (items) => (items ? normalizeOrderItemsForStock(items) : []);

module.exports = { getSourceMenuItemId, toRecipeLines };
