// Keeps recipe costs and menu HPP in step with stock average costs, like the
// owner's COGS sheet:
//   recipes.cost             = quantity x stock unit_cost (whole rupiah)
//   menu_item_prices.hpp_cost = sum of the menu's recipe costs
//   gross_profit             = regular_price - hpp_cost
//   a package (menu_item_bundle_items) hpp_cost = sum of its menus' hpp_cost
//                                   x quantity, refreshed with those menus
// A menu keeps its manual HPP while its recipe costs nothing yet (no purchase
// prices), the same fallback order HPP uses. Pass stockItemIds or menuItemIds
// to limit the refresh; with neither, every recipe is refreshed.
// Packages containing (or being) one of the menus; all with menuIds null.
const refreshBundleCosts = async (connection, menuIds) => {
  const [bundles] = await connection.query(
    `SELECT DISTINCT bundle_menu_item_id AS id
     FROM menu_item_bundle_items
     ${menuIds ? "WHERE menu_item_id IN (?) OR bundle_menu_item_id IN (?)" : ""}`,
    menuIds ? [menuIds, menuIds] : []
  );
  if (!bundles.length) return;

  await connection.query(
    `UPDATE menu_item_prices mip
     JOIN (
       SELECT bi.bundle_menu_item_id, SUM(bi.quantity * COALESCE(item_prices.hpp_cost, 0)) AS hpp
       FROM menu_item_bundle_items bi
       LEFT JOIN menu_item_prices item_prices ON item_prices.menu_item_id = bi.menu_item_id
       WHERE bi.bundle_menu_item_id IN (?)
       GROUP BY bi.bundle_menu_item_id
     ) costs ON costs.bundle_menu_item_id = mip.menu_item_id
     SET mip.hpp_cost = costs.hpp,
         mip.gross_profit = mip.regular_price - costs.hpp`,
    [bundles.map((bundle) => bundle.id)]
  );
};

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
  await refreshBundleCosts(connection, menuIds);
};

module.exports = { refreshMenuCosts };
