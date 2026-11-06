// Keeps recipe costs and menu HPP in step with stock average costs, like the
// owner's COGS sheet:
//   recipes.cost             = quantity x stock unit_cost (whole rupiah)
//   menu_item_prices.hpp_cost = sum of the menu's recipe costs
//   gross_profit             = regular_price - hpp_cost
//   a package (Kategori Promo)  hpp_cost = 0: each sale counts the HPP of
//                                   the menus in it (order snapshot); its
//                                   gross_profit is entered by hand
// A menu keeps its manual HPP while its recipe costs nothing yet (no purchase
// prices), the same fallback order HPP uses. Pass stockItemIds or menuItemIds
// to limit the refresh; with neither, every recipe is refreshed.
// Packages have no HPP of their own (see above); their gross profit stays.
const clearBundleCosts = (connection) =>
  connection.query(
    `UPDATE menu_item_prices mip
     SET mip.hpp_cost = 0
     WHERE mip.hpp_cost <> 0
       AND (
         EXISTS (SELECT 1 FROM menu_item_bundle_items bi WHERE bi.bundle_menu_item_id = mip.menu_item_id)
         OR EXISTS (SELECT 1 FROM menu_item_bundle_choices bc WHERE bc.bundle_menu_item_id = mip.menu_item_id)
       )`
  );

const refreshMenuCosts = async (connection, { stockItemIds, menuItemIds } = {}) => {
  let menuIds = menuItemIds;

  if (stockItemIds) {
    if (!stockItemIds.length) return;

    const [rows] = await connection.query(
      "SELECT DISTINCT menu_item_id FROM recipes WHERE stock_item_id IN (?)",
      [stockItemIds]
    );
    menuIds = rows.map((row) => row.menu_item_id);
  }

  if (menuIds && !menuIds.length) return;

  const filter = menuIds ? "WHERE r.menu_item_id IN (?)" : "";
  const params = menuIds ? [menuIds] : [];

  await connection.query(
    `UPDATE recipes r
     JOIN stock_items si ON si.id = r.stock_item_id
     SET r.cost = ROUND(r.quantity * si.unit_cost)
     ${filter}`,
    params
  );
  await connection.query(
    `UPDATE menu_item_prices mip
     JOIN (
       SELECT r.menu_item_id, SUM(r.cost) AS hpp
       FROM recipes r
       ${filter}
       GROUP BY r.menu_item_id
     ) costs ON costs.menu_item_id = mip.menu_item_id
     SET mip.hpp_cost = costs.hpp,
         mip.gross_profit = mip.regular_price - costs.hpp
     WHERE costs.hpp > 0`,
    params
  );
  await clearBundleCosts(connection);
};

module.exports = { refreshMenuCosts };
