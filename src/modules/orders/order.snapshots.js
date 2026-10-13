// Values frozen onto an order at sale time: the item's HPP (from the current
// recipe/average cost, else the stored size/menu HPP) and the platform fee.
const { parseNominal, roundCurrency } = require("../../shared/utils/money");
const { convertRecipeQuantity } = require("../../shared/utils/units");

const findMenuItemSnapshot = async (connection, menuItemId, sizeName = "") => {
  if (!menuItemId) return { menuItemId: null, hppCost: 0 };

  const [ingredientRows] = await connection.query(
    `SELECT
       mii.quantity,
       mii.unit AS ingredient_unit,
       mii.size_name,
       si.unit AS stock_unit,
       si.average_cost
     FROM menu_item_ingredients mii
     JOIN stock_items si ON si.id = mii.stock_item_id
     WHERE mii.menu_item_id = ?
       AND mii.stock_item_id IS NOT NULL`,
    [menuItemId]
  );
  const normalizedSizeName = String(sizeName || "").trim().toLowerCase();
  const dynamicHpp = ingredientRows.reduce((total, ingredient) => {
    const ingredientSizeName = String(ingredient.size_name || "").trim().toLowerCase();

    if (
      ingredientSizeName &&
      (!normalizedSizeName || ingredientSizeName !== normalizedSizeName)
    ) {
      return total;
    }

    const stockQuantity = convertRecipeQuantity(
      Number(ingredient.quantity) || 0,
      ingredient.ingredient_unit,
      ingredient.stock_unit
    );

    return total + stockQuantity * Number(ingredient.average_cost || 0);
  }, 0);

  const [rows] = await connection.query(
    `SELECT mi.id,
            COALESCE(
       (
         SELECT mis.hpp_cost
         FROM menu_item_sizes mis
         WHERE mis.menu_item_id = mi.id
           AND LOWER(mis.name) = LOWER(?)
         LIMIT 1
       ),
       (
         SELECT mis.hpp_cost
         FROM menu_item_sizes mis
         WHERE mis.menu_item_id = mi.id
         ORDER BY mis.sort_order ASC, mis.id ASC
         LIMIT 1
       ),
       mi.hpp_cost,
       0
     ) AS hpp_cost
     FROM menu_items mi
     WHERE mi.id = ?
     LIMIT 1`,
    [sizeName, menuItemId]
  );

  if (!rows.length) return { menuItemId: null, hppCost: 0 };

  return {
    menuItemId: rows[0].id,
    hppCost: dynamicHpp > 0 ? roundCurrency(dynamicHpp) : Number(rows[0].hpp_cost || 0),
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
