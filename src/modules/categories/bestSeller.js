// Best Seller tabs on Home: a category's menus are ranked under Makanan,
// Minuman or Snack, or not at all (null). Admins choose it in Pengaturan →
// Best Seller (categories.best_seller_group, '' = not shown). A category never
// set (NULL) gets one from its name: drinks Minuman, snack/roti/kue Snack,
// Catering (its own panel), Kategori Promo and add-ons none, the rest Makanan.
const BEST_SELLER_GROUPS = ["Makanan", "Minuman", "Snack"];

const HIDDEN_NAMES = /catering|add.?ons?|topping|tambahan|extra/i;
const DRINK_NAMES = /coffee|kopi|\btea\b|\bteh\b|matcha|minuman|beverage|drink|juice|\bjus\b|milk|susu|latte|soda|smoothie/i;
const SNACK_NAMES = /snack|roti|cemilan|camilan|pastry|cake|\bkue\b|dessert|gorengan|bread|toast/i;

const bestSellerGroupOf = ({ group, name, isBundle }) => {
  if (group !== null && group !== undefined) return BEST_SELLER_GROUPS.includes(group) ? group : null;
  const categoryName = String(name || "");
  if (isBundle || HIDDEN_NAMES.test(categoryName)) return null;
  if (DRINK_NAMES.test(categoryName)) return "Minuman";
  if (SNACK_NAMES.test(categoryName)) return "Snack";
  return "Makanan";
};

module.exports = { BEST_SELLER_GROUPS, bestSellerGroupOf };
