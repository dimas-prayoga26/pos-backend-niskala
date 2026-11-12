// Keeps recipe costs and menu HPP in step with stock average costs, like the
// owner's COGS sheet:
//   menu_item_recipes.cost                  = quantity x bahan baku unit_cost
//                                   (stock_raw_items, whole rupiah)
//   stock_semi_item_menus.cost    = quantity x bahan olahan unit_cost
//                                   (stock_semi_items) for a menu's semi lines
//   stock_semi_item_recipes.cost  = quantity x bahan baku unit_cost for a semi
//                                   item's composition
//   stock_semi_items.unit_cost    = with no portions in stock, its takaran
//                                   standar: that composition over
//                                   default_portions
//   menu_item_prices.hpp_cost     = sum of the menu's menu_item_recipes and semi lines
//   gross_profit                  = regular_price - hpp_cost
//   a package (Kategori Promo)    hpp_cost = 0: each sale counts the HPP of
//                                   the menus in it (order snapshot); its
//                                   gross_profit is entered by hand
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

// A bahan olahan with no portions in stock costs its takaran standar: its
// composition at today's prices over default_portions (Catat Masak's
// default). Portions in stock keep their cooking's cost. Limited to the semi
// items given or made of the raw items given (null: all). Returns the ids
// whose cost changed.
const refreshStandardSemiCosts = async (connection, { stockItemIds = null, semiItemIds = null } = {}) => {
  const limits = [];
  const params = [];
  if (stockItemIds || semiItemIds) {
    limits.push(`(ss.id IN (?) OR ss.id IN (SELECT semi_item_id FROM stock_semi_item_recipes WHERE stock_item_id IN (?)))`);
    params.push(semiItemIds?.length ? semiItemIds : [0], stockItemIds?.length ? stockItemIds : [0]);
  }
  const [rows] = await connection.query(
    `SELECT ss.id, ss.unit_cost, ROUND(SUM(sr.cost) / ss.default_portions) AS standard_cost
     FROM stock_semi_items ss
     JOIN stock_semi_item_recipes sr ON sr.semi_item_id = ss.id
     WHERE ss.stock <= 0 AND ss.default_portions > 0 ${limits.map((limit) => `AND ${limit}`).join(" ")}
     GROUP BY ss.id, ss.unit_cost, ss.default_portions`,
    params
  );
  const changed = rows.filter((row) => Number(row.standard_cost) !== Number(row.unit_cost));
  for (const row of changed) {
    await connection.query("UPDATE stock_semi_items SET unit_cost = ? WHERE id = ?", [row.standard_cost, row.id]);
  }
  return changed.map((row) => row.id);
};

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

const refreshMenuCosts = async (
  connection,
  { stockItemIds, semiItemIds, menuItemIds } = {}
) => {
  let menuIds = menuItemIds;

  if (stockItemIds || semiItemIds) {
    const rawIds = stockItemIds || [];
    let semiIds = semiItemIds || [];
    if (!rawIds.length && !semiIds.length) return;

    if (rawIds.length) await refreshSemiRecipeCosts(connection, rawIds);
    const standardIds = await refreshStandardSemiCosts(connection, { stockItemIds: rawIds, semiItemIds: semiIds });
    semiIds = [...new Set([...semiIds, ...standardIds])];

    const [rows] = await connection.query(
      `SELECT menu_item_id FROM menu_item_recipes WHERE stock_item_id IN (?)
       UNION
       SELECT menu_item_id FROM stock_semi_item_menus WHERE semi_item_id IN (?)`,
      [rawIds.length ? rawIds : [0], semiIds.length ? semiIds : [0]]
    );
    menuIds = rows.map((row) => row.menu_item_id);
  } else if (!menuItemIds) {
    await refreshSemiRecipeCosts(connection, null);
    await refreshStandardSemiCosts(connection);
  }

  if (menuIds && !menuIds.length) return;

  const filter = (alias) => (menuIds ? `WHERE ${alias}.menu_item_id IN (?)` : "");
  const params = menuIds ? [menuIds] : [];

  await connection.query(
    `UPDATE menu_item_recipes r
     JOIN stock_raw_items si ON si.id = r.stock_item_id
     SET r.cost = ROUND(r.quantity * si.unit_cost)
     ${filter("r")}`,
    params
  );
  await connection.query(
    `UPDATE stock_semi_item_menus sm
     JOIN stock_semi_items ss ON ss.id = sm.semi_item_id
     SET sm.cost = ROUND(sm.quantity * ss.unit_cost)
     ${filter("sm")}`,
    params
  );
  await connection.query(
    `UPDATE menu_item_prices mip
     JOIN (
       SELECT recipe_lines.menu_item_id, SUM(recipe_lines.cost) AS hpp
       FROM (
         SELECT r.menu_item_id, r.cost FROM menu_item_recipes r ${filter("r")}
         UNION ALL
         SELECT sm.menu_item_id, sm.cost FROM stock_semi_item_menus sm ${filter("sm")}
       ) recipe_lines
       GROUP BY recipe_lines.menu_item_id
     ) costs ON costs.menu_item_id = mip.menu_item_id
     SET mip.hpp_cost = costs.hpp,
         mip.gross_profit = mip.regular_price - costs.hpp
     WHERE costs.hpp > 0`,
    [...params, ...params]
  );
  await clearBundleCosts(connection);
};

module.exports = { refreshMenuCosts };
