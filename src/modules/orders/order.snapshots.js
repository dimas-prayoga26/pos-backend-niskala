// Values frozen onto an order at sale time: the item's HPP with its
// per-ingredient breakdown (current recipe x average cost, else the HPP stored
// in menu_item_prices) and the platform fee.
const { parseNominal } = require("../../shared/utils/money");
const { findBundleRows } = require("../menu/menu.bundles");

const round4 = (value) => Math.round(value * 10000) / 10000;

// A promo package (menu_item_bundle_items): the HPP of each of its menus
// (recipe, else the menu's stored HPP) times its quantity. The bahan lines of
// all menus are combined per bahan; a menu priced by its stored HPP alone
// adds one line in portions, so the lines still add up to the HPP.
const findBundleSnapshot = async (connection, bundleId, bundleRows) => {
  const lines = new Map();
  let hppCost = 0;

  for (const row of bundleRows) {
    const quantity = Number(row.quantity) || 0;
    const item = await findMenuItemSnapshot(connection, Number(row.menu_item_id), { nested: true });
    hppCost += item.hppCost * quantity;

    for (const line of item.costs) {
      const key = `stock:${line.stockItemId}`;
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
      lines.set(`menu:${row.menu_item_id}`, {
        stockItemId: null,
        stockItemName: row.name,
        quantity,
        unit: "porsi",
        unitCost: unpriced,
        cost: unpriced * quantity,
      });
    }
  }

  return { menuItemId: bundleId, hppCost, costs: [...lines.values()] };
};

const findMenuItemSnapshot = async (connection, menuItemId, { nested = false } = {}) => {
  if (!menuItemId) return { menuItemId: null, hppCost: 0, costs: [] };

  // Packages hold ordinary menus only, so their menus are not expanded again.
  if (!nested) {
    const bundleRows = await findBundleRows(connection, [menuItemId]);
    if (bundleRows.length) return findBundleSnapshot(connection, menuItemId, bundleRows);
  }

  const [recipeRows] = await connection.query(
    `SELECT
       r.stock_item_id,
       si.name AS stock_item_name,
       r.quantity,
       si.unit,
       si.unit_cost,
       ROUND(r.quantity * si.unit_cost) AS cost
     FROM recipes r
     JOIN stock_items si ON si.id = r.stock_item_id
     WHERE r.menu_item_id = ?
     ORDER BY r.sort_order ASC, r.id ASC`,
    [menuItemId]
  );
  const costs = recipeRows.map((row) => ({
    stockItemId: row.stock_item_id,
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
