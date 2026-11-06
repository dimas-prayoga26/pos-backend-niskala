// Values frozen onto an order at sale time: the item's HPP with its
// per-ingredient breakdown (current recipe x average cost, else the HPP stored
// in menu_item_prices) and the platform fee.
const { parseNominal } = require("../../shared/utils/money");
const { findBundleRows } = require("../menu/menu.bundles");
const { findRecipeLines } = require("../menu/menu.recipeLines");

const round4 = (value) => Math.round(value * 10000) / 10000;

// A promo package (menu_item_bundle_items, plus the menus picked for its
// choices): the HPP of each of its menus (recipe, else the menu's stored HPP)
// times its quantity. The lines of all menus are combined per bahan baku or
// bahan olahan; a menu priced by its stored HPP alone adds one line in
// portions, so the lines still add up to the HPP.
const findBundleSnapshot = async (connection, bundleId, bundleRows) => {
  const lines = new Map();
  let hppCost = 0;

  for (const row of bundleRows) {
    const quantity = Number(row.quantity) || 0;
    const item = await findMenuItemSnapshot(connection, Number(row.menu_item_id), { nested: true });
    hppCost += item.hppCost * quantity;

    for (const line of item.costs) {
      const key = line.semiItemId ? `semi:${line.semiItemId}` : `raw:${line.stockItemId}`;
      const current = lines.get(key);
      if (current) {
        current.quantity = round4(current.quantity + line.quantity * quantity);
        current.cost += line.cost * quantity;
      } else {
        lines.set(key, { ...line, quantity: round4(line.quantity * quantity), cost: line.cost * quantity });
      }
    }

    const unpriced = item.hppCost - item.costs.reduce((total, line) => total + line.cost, 0);
    if (unpriced > 0) {
      const key = `menu:${row.menu_item_id}`;
      const current = lines.get(key);
      if (current) {
        current.quantity += quantity;
        current.cost += unpriced * quantity;
      } else {
        lines.set(key, {
          stockItemId: null,
          semiItemId: null,
          stockItemName: row.name,
          quantity,
          unit: "porsi",
          unitCost: unpriced,
          cost: unpriced * quantity,
          hppType: "standar",
          isPending: false,
        });
      }
    }
  }

  return { menuItemId: bundleId, hppCost, costs: [...lines.values()] };
};

// choices: the menus picked for the package's choices ({ menuItemId, name, quantity }).
const findMenuItemSnapshot = async (
  connection,
  menuItemId,
  { nested = false, choices = [] } = {}
) => {
  if (!menuItemId) return { menuItemId: null, hppCost: 0, costs: [] };

  // Packages hold ordinary menus only, so their menus are not expanded again.
  if (!nested) {
    const bundleRows = [
      ...(await findBundleRows(connection, [menuItemId])),
      ...choices.map((choice) => ({
        menu_item_id: choice.menuItemId,
        quantity: choice.quantity,
        name: choice.name,
      })),
    ];
    if (bundleRows.length) return findBundleSnapshot(connection, menuItemId, bundleRows);
  }

  // Bahan baku lines (menu_item_recipes) and bahan olahan lines
  // (stock_semi_item_menus) of the menu.
  const recipeRows = await findRecipeLines(connection, [menuItemId]);
  const costs = recipeRows.map((row) => ({
    stockItemId: row.stock_item_id,
    semiItemId: row.semi_item_id,
    stockItemName: row.name,
    quantity: Number(row.quantity) || 0,
    unit: row.unit || "",
    unitCost: Number(row.unit_cost) || 0,
    cost: Number(row.line_cost) || 0,
    // HPP standar (bahan baku) or HPP olahan, priced by the day's cooking (order.hpp).
    hppType: row.kind === "semi" ? "olahan" : "standar",
    isPending: row.kind === "semi",
  }));
  const recipeHpp = costs.reduce((total, line) => total + line.cost, 0);

  const [rows] = await connection.query(
    `SELECT mi.id, COALESCE(mip.hpp_cost, 0) AS hpp_cost
     FROM menu_items mi
     LEFT JOIN menu_item_prices mip ON mip.menu_item_id = mi.id
     WHERE mi.id = ?
     LIMIT 1`,
    [menuItemId]
  );

  if (!rows.length) return { menuItemId: null, hppCost: 0, costs: [] };

  return {
    menuItemId: rows[0].id,
    hppCost: recipeHpp > 0 ? recipeHpp : Number(rows[0].hpp_cost || 0),
    costs,
  };
};

const findPlatformSnapshot = async (
  connection,
  { platformId, platformName, platformTax }
) => {
  const normalizedPlatformId = Number(platformId);

  if (Number.isFinite(normalizedPlatformId) && normalizedPlatformId > 0) {
    const [rows] = await connection.query(
      `SELECT id, name, tax
       FROM meta_data_platform
       WHERE id = ?
       LIMIT 1`,
      [normalizedPlatformId]
    );

    if (rows.length) {
      const submittedTax =
        platformTax === null || platformTax === undefined || platformTax === ""
          ? null
          : parseNominal(platformTax);

      return {
        id: rows[0].id,
        name: rows[0].name,
        tax: submittedTax ?? Number(rows[0].tax || 0),
      };
    }
  }

  const normalizedPlatformName = String(platformName || "").trim();
  if (normalizedPlatformName) {
    const [rows] = await connection.query(
      `SELECT id, name, tax
       FROM meta_data_platform
       WHERE LOWER(name) = LOWER(?)
       LIMIT 1`,
      [normalizedPlatformName]
    );

    if (rows.length) {
      const submittedTax =
        platformTax === null || platformTax === undefined || platformTax === ""
          ? null
          : parseNominal(platformTax);

      return {
        id: rows[0].id,
        name: rows[0].name,
        tax: submittedTax ?? Number(rows[0].tax || 0),
      };
    }

    return {
      id: null,
      name: normalizedPlatformName,
      tax: parseNominal(platformTax),
    };
  }

  return null;
};

module.exports = { findMenuItemSnapshot, findPlatformSnapshot };
