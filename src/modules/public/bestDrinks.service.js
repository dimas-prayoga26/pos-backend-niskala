// Best-selling drinks for the website ("Popular Coffee Menu"). Ranked like the
// Minuman tab of Best Seller on the POS Home: quantity sold, the Ice and Hot
// copy of a menu counted together (same name), only menus still on sale.
// Nothing internal (HPP, recipes, sales figures) leaves this module.
const { pool } = require("../../infrastructure/database/pool");
const MenuItem = require("../menu/menu.repository");

const DRINK_GROUP = "Minuman";
// Free crew meals say nothing about what customers like.
const EXCLUDED_ORDER_TYPES = ["Crew"];

const normalizeName = (value) => String(value || "").trim().toLowerCase();

const toImageUrl = (imagePath, baseUrl) => {
  if (!imagePath) return null;
  if (/^https?:\/\//i.test(imagePath)) return imagePath;
  return `${baseUrl}${imagePath.startsWith("/") ? "" : "/"}${imagePath}`;
};

// Same rule as the cashier's menu card: the price less its discount percent.
const finalPriceOf = (price, discountPercent) => {
  if (price === null || price === undefined) return null;
  return discountPercent ? Math.round((price * (100 - discountPercent)) / 100) : price;
};

// Quantity sold per order line menu (id, else name).
const findSales = async ({ days = null } = {}) => {
  const params = [EXCLUDED_ORDER_TYPES];
  let since = "";
  if (days) {
    since = "AND o.order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL ? DAY)";
    params.push(days);
  }
  const [rows] = await pool.query(
    `SELECT oi.menu_item_id, oi.name, SUM(oi.quantity) AS quantity
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     WHERE o.order_type NOT IN (?) ${since}
     GROUP BY oi.menu_item_id, oi.name`,
    params
  );
  return rows.map((row) => ({
    menuItemId: row.menu_item_id,
    name: row.name,
    quantity: Number(row.quantity) || 0,
  }));
};

// salesRows: [{ menuItemId, name, quantity }]; menuItems: sellable menus in
// the POS order (the first of a name, the Ice copy, stands for the menu).
const rankDrinks = (salesRows, menuItems, { limit, baseUrl }) => {
  const drinks = menuItems.filter((item) => item.category?.bestSellerGroup === DRINK_GROUP);
  const drinkById = new Map(drinks.map((item) => [Number(item.id), item]));
  const drinkByName = new Map();
  drinks.forEach((item) => {
    const name = normalizeName(item.name);
    if (!drinkByName.has(name)) drinkByName.set(name, item);
  });

  const soldByName = new Map();
  salesRows.forEach((row) => {
    const menu = (row.menuItemId != null && drinkById.get(Number(row.menuItemId))) || drinkByName.get(normalizeName(row.name));
    if (!menu) return;
    const name = normalizeName(menu.name);
    soldByName.set(name, (soldByName.get(name) || 0) + row.quantity);
  });

  return [...soldByName]
    .filter(([, quantity]) => quantity > 0)
    .sort(([firstName, first], [secondName, second]) => second - first || firstName.localeCompare(secondName))
    .slice(0, limit)
    .map(([name], index) => {
      const menu = drinkByName.get(name);
      const discountPercent = Number(menu.discountPercent) || 0;
      return {
        rank: index + 1,
        id: menu.id,
        name: menu.name,
        category: menu.category.name,
        price: finalPriceOf(menu.regularPrice, discountPercent),
        imageUrl: toImageUrl(menu.imagePath, baseUrl),
      };
    });
};

const listBestDrinks = async ({ limit = 4, days = null, baseUrl = "" } = {}) => {
  const [salesRows, menuItems] = await Promise.all([findSales({ days }), MenuItem.findAll()]);
  return rankDrinks(salesRows, menuItems, { limit, baseUrl });
};

module.exports = { finalPriceOf, listBestDrinks, rankDrinks, toImageUrl };
