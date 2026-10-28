// Recipe lines of menus: bahan baku rows (recipes -> stock_raw_items) and
// bahan setengah jadi rows (stock_semi_item_menus -> stock_semi_items), in each
// menu's line order. Two queries instead of a UNION, so tables created with
// different collations (older tables vs. the database default) still combine.
const findRecipeLines = async (connection, menuItemIds) => {
  if (!menuItemIds.length) return [];

  const [rawRows] = await connection.query(
    `SELECT r.id, r.menu_item_id, r.stock_item_id, r.quantity, r.note, r.sort_order,
            si.name, si.unit, si.stock, si.unit_cost, si.is_unlimited,
            ROUND(r.quantity * si.unit_cost) AS line_cost
     FROM recipes r
     JOIN stock_raw_items si ON si.id = r.stock_item_id
     WHERE r.menu_item_id IN (?)`,
    [menuItemIds]
  );
  const [semiRows] = await connection.query(
    `SELECT sm.id, sm.menu_item_id, sm.semi_item_id, sm.quantity, sm.note, sm.sort_order,
            ss.name, ss.unit, ss.stock, ss.unit_cost,
            ROUND(sm.quantity * ss.unit_cost) AS line_cost
     FROM stock_semi_item_menus sm
     JOIN stock_semi_items ss ON ss.id = sm.semi_item_id
     WHERE sm.menu_item_id IN (?)`,
    [menuItemIds]
  );

  const kindOrder = { raw: 0, semi: 1 };
  return [
    ...rawRows.map((row) => ({ ...row, semi_item_id: null, kind: "raw" })),
    ...semiRows.map((row) => ({ ...row, stock_item_id: null, is_unlimited: 0, kind: "semi" })),
  ].sort(
    (a, b) =>
      a.sort_order - b.sort_order || kindOrder[a.kind] - kindOrder[b.kind] || a.id - b.id
  );
};

module.exports = { findRecipeLines };
