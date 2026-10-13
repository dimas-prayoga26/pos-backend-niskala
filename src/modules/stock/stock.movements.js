// Recipe-driven stock movements. Orders pass recipe lines
// ({ menuItemId, sizeName, quantity }); each menu item's ingredients
// (menu_item_ingredients) are converted to the stock unit and applied to
// stock_items inside the caller's transaction connection.
const createHttpError = require("http-errors");
const { roundCurrency } = require("../../shared/utils/money");
const { convertRecipeQuantity } = require("../../shared/utils/units");

const createStockValidationError = (insufficientStock) =>
  createHttpError(409, "Stok bahan tidak mencukupi.", {
    details: { insufficientStock },
  });

const buildStockDeductions = async (connection, orderItems = []) => {
  if (!orderItems.length) return new Map();

  const menuItemIds = [...new Set(orderItems.map((item) => item.menuItemId))];
  const [ingredientRows] = await connection.query(
    `SELECT
       mii.menu_item_id,
       mii.stock_item_id,
       mii.size_name,
       mii.quantity,
       mii.unit AS ingredient_unit,
       si.name AS stock_name,
       si.stock,
       si.unit AS stock_unit,
       si.average_cost,
       si.is_unlimited
     FROM menu_item_ingredients mii
     JOIN stock_items si ON si.id = mii.stock_item_id
     WHERE mii.menu_item_id IN (?)
       AND mii.stock_item_id IS NOT NULL`,
    [menuItemIds]
  );

  if (!ingredientRows.length) return new Map();

  const deductions = new Map();

  for (const orderItem of orderItems) {
    const matchingIngredients = ingredientRows.filter((ingredient) => {
      if (Number(ingredient.menu_item_id) !== orderItem.menuItemId) return false;

      const ingredientSizeName = String(ingredient.size_name || "").trim();

      return (
        !ingredientSizeName ||
        (orderItem.sizeName &&
          ingredientSizeName.toLowerCase() === orderItem.sizeName.toLowerCase())
      );
    });

    for (const ingredient of matchingIngredients) {
      const stockItemId = Number(ingredient.stock_item_id);
      const deduction = convertRecipeQuantity(
        (Number(ingredient.quantity) || 0) * orderItem.quantity,
        ingredient.ingredient_unit,
        ingredient.stock_unit
      );

      if (!stockItemId || deduction <= 0) continue;

      const currentDeduction = deductions.get(stockItemId) || {
        stockItemId,
        name: ingredient.stock_name,
        stock: Number(ingredient.stock || 0),
        unit: ingredient.stock_unit || "",
        averageCost: Number(ingredient.average_cost || 0),
        isUnlimited: Boolean(ingredient.is_unlimited),
        required: 0,
        requiredValue: 0,
      };

      currentDeduction.required += deduction;
      currentDeduction.requiredValue += roundCurrency(
        deduction * currentDeduction.averageCost
      );
      deductions.set(stockItemId, currentDeduction);
    }
  }

  return deductions;
};

const getInsufficientStock = (deductions) =>
  Array.from(deductions.values())
    .filter(
      (deduction) =>
        !deduction.isUnlimited && deduction.required > deduction.stock
    )
    .map((deduction) => ({
      stockItemId: deduction.stockItemId,
      name: deduction.name,
      stock: deduction.stock,
      required: deduction.required,
      shortage: deduction.required - deduction.stock,
      unit: deduction.unit,
    }));

const applyStockDeductions = async (connection, deductions) => {
  for (const deduction of deductions.values()) {
    await connection.query(
      `UPDATE stock_items
       SET stock = CASE
         WHEN is_unlimited = TRUE THEN stock
         ELSE stock - ?
       END,
       stock_value = CASE
         WHEN is_unlimited = TRUE THEN stock_value
         ELSE GREATEST(stock_value - ?, 0)
       END
       WHERE id = ?`,
      [deduction.required, deduction.requiredValue, deduction.stockItemId]
    );
  }

  return deductions.size;
};

const deductIngredientStock = async (
  connection,
  items = [],
  { allowNegativeStock = false } = {}
) => {
  const deductions = await buildStockDeductions(connection, items);
  if (!deductions.size) return 0;

  const insufficientStock = getInsufficientStock(deductions);
  if (insufficientStock.length && !allowNegativeStock) {
    throw createStockValidationError(insufficientStock);
  }

  return applyStockDeductions(connection, deductions);
};

const restoreIngredientStock = async (connection, items = []) => {
  const deductions = await buildStockDeductions(connection, items);
  if (!deductions.size) return 0;

  for (const deduction of deductions.values()) {
    await connection.query(
      `UPDATE stock_items
       SET stock = CASE
         WHEN is_unlimited = TRUE THEN stock
         ELSE stock + ?
       END,
       stock_value = CASE
         WHEN is_unlimited = TRUE THEN stock_value
         ELSE stock_value + ?
       END
       WHERE id = ?`,
      [deduction.required, deduction.requiredValue, deduction.stockItemId]
    );
  }

  return deductions.size;
};

module.exports = {
  deductIngredientStock,
  restoreIngredientStock,
};
