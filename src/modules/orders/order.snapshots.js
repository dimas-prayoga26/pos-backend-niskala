// Values frozen onto an order at sale time: the item's HPP with its
// per-ingredient breakdown (current recipe x average cost, else the HPP stored
// in menu_item_prices) and the platform fee.
const { parseNominal } = require("../../shared/utils/money");

const findMenuItemSnapshot = async (connection, menuItemId) => {
  if (!menuItemId) return { menuItemId: null, hppCost: 0, costs: [] };

  // Each line is a bahan baku (stock_raw_items) or bahan setengah jadi
  // (stock_semi_items).
  const [recipeRows] = await connection.query(
    `SELECT
       r.stock_item_id,
       r.semi_item_id,
       COALESCE(si.name, ss.name) AS stock_item_name,
       r.quantity,
       COALESCE(si.unit, ss.unit) AS unit,
       COALESCE(si.unit_cost, ss.unit_cost) AS unit_cost,
       ROUND(r.quantity * COALESCE(si.unit_cost, ss.unit_cost)) AS cost
     FROM recipes r
     LEFT JOIN stock_raw_items si ON si.id = r.stock_item_id
     LEFT JOIN stock_semi_items ss ON ss.id = r.semi_item_id
     WHERE r.menu_item_id = ?
       AND (si.id IS NOT NULL OR ss.id IS NOT NULL)
     ORDER BY r.sort_order ASC, r.id ASC`,
    [menuItemId]
  );
  const costs = recipeRows.map((row) => ({
    stockItemId: row.stock_item_id,
    semiItemId: row.semi_item_id,
    stockItemName: row.stock_item_name,
    quantity: Number(row.quantity) || 0,
    unit: row.unit || "",
    unitCost: Number(row.unit_cost) || 0,
    cost: Number(row.cost) || 0,
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
