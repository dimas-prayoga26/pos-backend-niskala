// Keeps recipe costs and menu HPP in step with stock average costs, like the
// owner's COGS sheet:
//   recipes.cost                  = quantity x unit_cost of its bahan baku
//                                   (stock_raw_items) or bahan setengah jadi
//                                   (stock_semi_items), whole rupiah
//   stock_semi_item_recipes.cost  = the same for a semi item's composition
//   menu_item_prices.hpp_cost     = sum of the menu's recipe costs
//   gross_profit                  = regular_price - hpp_cost
// A menu keeps its manual HPP while its recipe costs nothing yet (no purchase
// prices), the same fallback order HPP uses. Pass stockItemIds (raw),
// semiItemIds or menuItemIds to limit the refresh; with none, every recipe is
// refreshed.
const refreshSemiRecipeCosts = (connection, stockItemIds) =>
  connection.query(
    `UPDATE stock_semi_item_recipes sr
     JOIN stock_raw_items si ON si.id = sr.stock_item_id
     SET sr.cost = ROUND(sr.quantity * si.unit_cost)
     ${stockItemIds ? "WHERE sr.stock_item_id IN (?)" : ""}`,
    stockItemIds ? [stockItemIds] : []
  );

const refreshMenuCosts = async (
  connection,
  { stockItemIds, semiItemIds, menuItemIds } = {}
) => {
  let menuIds = menuItemIds;

  if (stockItemIds || semiItemIds) {
    const rawIds = stockItemIds || [];
    const semiIds = semiItemIds || [];
    if (!rawIds.length && !semiIds.length) return;

    if (rawIds.length) await refreshSemiRecipeCosts(connection, rawIds);

    const [rows] = await connection.query(
      `SELECT DISTINCT menu_item_id FROM recipes
       WHERE stock_item_id IN (?) OR semi_item_id IN (?)`,
      [rawIds.length ? rawIds : [0], semiIds.length ? semiIds : [0]]
    );
    menuIds = rows.map((row) => row.menu_item_id);
  } else if (!menuItemIds) {
    await refreshSemiRecipeCosts(connection, null);
  }

  if (menuIds && !menuIds.length) return;

  const filter = menuIds ? "WHERE r.menu_item_id IN (?)" : "";
  const params = menuIds ? [menuIds] : [];

  await connection.query(
    `UPDATE recipes r
     LEFT JOIN stock_raw_items si ON si.id = r.stock_item_id
     LEFT JOIN stock_semi_items ss ON ss.id = r.semi_item_id
     SET r.cost = ROUND(r.quantity * COALESCE(si.unit_cost, ss.unit_cost, 0))
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
};

module.exports = { refreshMenuCosts };
