// Keeps recipe costs and menu HPP in step with stock unit costs, like the
// owner's COGS sheet:
//   prepared item unit_cost  = sum of its component costs / yield_quantity
//   recipes.cost             = quantity x stock unit_cost (whole rupiah)
//   menu_item_prices.hpp_cost = sum of the menu's recipe costs
//   gross_profit             = regular_price - hpp_cost
// A menu keeps its manual HPP while its recipe costs nothing yet (no purchase
// prices), the same fallback order HPP uses. Pass stockItemIds or menuItemIds
// to limit the refresh; with neither, everything is refreshed.

// Prepared items (bahan olahan, e.g. Nasi from Beras) using any of
// stockItemIds, or being one of them; all prepared items when null. Returns
// the prepared item ids it refreshed.
const refreshPreparedItemCosts = async (connection, stockItemIds) => {
  let preparedIds = null;

  if (stockItemIds) {
    const [rows] = await connection.query(
      `SELECT DISTINCT prepared_item_id AS id
       FROM prepared_item_recipes
       WHERE stock_item_id IN (?) OR prepared_item_id IN (?)`,
      [stockItemIds, stockItemIds]
    );
    preparedIds = rows.map((row) => row.id);
    if (!preparedIds.length) return [];
  }

  const filter = preparedIds ? "WHERE pr.prepared_item_id IN (?)" : "";
  const params = preparedIds ? [preparedIds] : [];

  await connection.query(
    `UPDATE prepared_item_recipes pr
     JOIN stock_items si ON si.id = pr.stock_item_id
     SET pr.cost = ROUND(pr.quantity * si.unit_cost)
     ${filter}`,
    params
  );
  await connection.query(
    `UPDATE stock_items p
     JOIN (
       SELECT pr.prepared_item_id, SUM(pr.cost) AS total
       FROM prepared_item_recipes pr
       ${filter}
       GROUP BY pr.prepared_item_id
     ) costs ON costs.prepared_item_id = p.id
     SET p.unit_cost = ROUND(costs.total / GREATEST(p.yield_quantity, 0.0001))`,
    params
  );

  if (preparedIds) return preparedIds;

  const [rows] = await connection.query(
    "SELECT DISTINCT prepared_item_id AS id FROM prepared_item_recipes"
  );
  return rows.map((row) => row.id);
};

const refreshMenuCosts = async (connection, { stockItemIds, menuItemIds } = {}) => {
  let menuIds = menuItemIds;

  if (stockItemIds) {
    if (!stockItemIds.length) return;

    // A changed ingredient also changes every prepared item made from it.
    const preparedIds = await refreshPreparedItemCosts(connection, stockItemIds);
    const [rows] = await connection.query(
      "SELECT DISTINCT menu_item_id FROM recipes WHERE stock_item_id IN (?)",
      [[...new Set([...stockItemIds, ...preparedIds])]]
    );
    menuIds = rows.map((row) => row.menu_item_id);
  } else if (!menuItemIds) {
    await refreshPreparedItemCosts(connection, null);
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
};

module.exports = { refreshMenuCosts };
