// Values frozen onto an order at sale time: the item's HPP with its
// per-ingredient breakdown (current recipe x average cost, else the HPP stored
// in menu_item_prices) and the platform fee.
const { parseNominal } = require("../../shared/utils/money");
const { findRecipeLines } = require("../menu/menu.recipeLines");

const findMenuItemSnapshot = async (connection, menuItemId) => {
  if (!menuItemId) return { menuItemId: null, hppCost: 0, costs: [] };

  // Bahan baku lines (menu_item_recipes) and bahan setengah jadi lines
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
