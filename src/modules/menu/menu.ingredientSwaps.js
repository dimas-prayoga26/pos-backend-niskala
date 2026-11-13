// Bahan olahan swapped in a menu (stock_semi_item_substitutes): a menu made
// with Nasi Putih may be sold with Nasi Daun Jeruk instead, extra_price more.
// The swap is set once on the bahan olahan, so every menu that uses it offers
// it. A swapped line keeps the menu's quantity and takes it from the
// substitute, so stock and HPP follow the bahan the customer got.
const createHttpError = require("http-errors");

// Active substitutes of semi items, in their order, with what a recipe line
// needs to price and move them.
const findSubstituteRows = async (db, semiItemIds) => {
  if (!semiItemIds.length) return [];

  const [rows] = await db.query(
    `SELECT s.semi_item_id, s.substitute_semi_item_id, s.extra_price,
            t.name, t.unit, t.stock, t.unit_cost
     FROM stock_semi_item_substitutes s
     JOIN stock_semi_items t ON t.id = s.substitute_semi_item_id AND t.is_active = TRUE
     WHERE s.semi_item_id IN (?)
     ORDER BY s.sort_order ASC, s.id ASC`,
    [semiItemIds]
  );
  return rows;
};

const lineCost = (quantity, unitCost) => Math.round((Number(quantity) || 0) * (Number(unitCost) || 0));

// The menu's bahan olahan lines that have substitutes (findRecipeLines rows of
// one menu), each with its options and the menu's HPP with that option.
const buildIngredientChoices = (menuHpp, recipeRows, substituteRows) =>
  recipeRows
    .filter((row) => row.kind === "semi")
    .map((row) => {
      const options = substituteRows
        .filter((substitute) => Number(substitute.semi_item_id) === Number(row.semi_item_id))
        .map((substitute) => ({
          semiItemId: substitute.substitute_semi_item_id,
          name: substitute.name,
          extraPrice: Number(substitute.extra_price) || 0,
          hppCost: Math.max(
            (Number(menuHpp) || 0) - (Number(row.line_cost) || 0) + lineCost(row.quantity, substitute.unit_cost),
            0
          ),
        }));

      return options.length
        ? {
            semiItemId: row.semi_item_id,
            name: row.name,
            quantity: Number(row.quantity) || 0,
            unit: row.unit,
            options,
          }
        : null;
    })
    .filter(Boolean);

// The swaps sent for one sold item ([{ fromSemiItemId, toSemiItemId }]),
// checked against the menu's recipe: one per bahan olahan of the menu, to one
// of its substitutes. Returns them with names and extra price for the order.
const resolveOrderIngredientSwaps = async (connection, menuItemId, requested) => {
  const wanted = new Map();
  for (const swap of Array.isArray(requested) ? requested : []) {
    const from = Number(swap?.fromSemiItemId);
    const to = Number(swap?.toSemiItemId);
    if (from > 0 && to > 0 && from !== to) wanted.set(from, to);
  }
  if (!wanted.size) return [];

  const [rows] = await connection.query(
    `SELECT sm.semi_item_id AS from_id, f.name AS from_name,
            s.substitute_semi_item_id AS to_id, t.name AS to_name, s.extra_price
     FROM stock_semi_item_menus sm
     JOIN stock_semi_items f ON f.id = sm.semi_item_id
     JOIN stock_semi_item_substitutes s ON s.semi_item_id = sm.semi_item_id
     JOIN stock_semi_items t ON t.id = s.substitute_semi_item_id AND t.is_active = TRUE
     WHERE sm.menu_item_id = ?`,
    [Number(menuItemId) || 0]
  );

  return [...wanted].map(([from, to]) => {
    const row = rows.find((candidate) => candidate.from_id === from && candidate.to_id === to);
    if (!row) {
      throw createHttpError(400, "Pilihan bahan tidak tersedia untuk menu ini. Muat ulang menu.");
    }
    return {
      fromSemiItemId: from,
      toSemiItemId: to,
      fromName: row.from_name,
      toName: row.to_name,
      extraPrice: Number(row.extra_price) || 0,
    };
  });
};

// Semi items by id, with what a swapped recipe line takes from them.
const findSemiRowsById = async (db, ids) => {
  const uniqueIds = [...new Set(ids.map(Number).filter((id) => id > 0))];
  if (!uniqueIds.length) return new Map();

  const [rows] = await db.query(
    "SELECT id, name, unit, stock, unit_cost FROM stock_semi_items WHERE id IN (?)",
    [uniqueIds]
  );
  return new Map(rows.map((row) => [row.id, row]));
};

// findRecipeLines rows of one menu with each swapped bahan olahan line taken
// from its substitute (same quantity).
const swapRecipeRows = (rows, swaps = [], semiRowsById = new Map()) => {
  if (!swaps.length) return rows;

  return rows.map((row) => {
    if (row.kind !== "semi") return row;

    const swap = swaps.find((candidate) => Number(candidate.fromSemiItemId) === Number(row.semi_item_id));
    const substitute = swap && semiRowsById.get(Number(swap.toSemiItemId));
    if (!substitute) return row;

    return {
      ...row,
      semi_item_id: substitute.id,
      name: substitute.name,
      unit: substitute.unit,
      stock: substitute.stock,
      unit_cost: substitute.unit_cost,
      line_cost: lineCost(row.quantity, substitute.unit_cost),
    };
  });
};

module.exports = {
  buildIngredientChoices,
  findSemiRowsById,
  findSubstituteRows,
  resolveOrderIngredientSwaps,
  swapRecipeRows,
};
