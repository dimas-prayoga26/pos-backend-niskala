// Recipe-driven stock movements. Orders pass recipe lines
// ({ menuItemId, quantity }); each menu item's recipe rows (recipes, quantities
// in the stock item's unit) are applied to stock_items inside the caller's
// transaction connection.
const createHttpError = require("http-errors");
const { roundCurrency } = require("../../shared/utils/money");

const createStockValidationError = (insufficientStock) =>
  createHttpError(409, "Stok bahan tidak mencukupi.", {
    details: { insufficientStock },
  });

const buildStockDeductions = async (connection, orderItems = []) => {
  if (!orderItems.length) return new Map();

  const menuItemIds = [...new Set(orderItems.map((item) => item.menuItemId))];
  const [ingredientRows] = await connection.query(
    `SELECT
       r.menu_item_id,
       r.stock_item_id,
       r.quantity,
       si.name AS stock_name,
       si.stock,
       si.unit AS stock_unit,
       si.unit_cost,
       si.is_unlimited
     FROM recipes r
     JOIN stock_items si ON si.id = r.stock_item_id
     WHERE r.menu_item_id IN (?)
     ORDER BY r.sort_order ASC, r.id ASC`,
    [menuItemIds]
  );

  if (!ingredientRows.length) return new Map();

  const deductions = new Map();

  for (const orderItem of orderItems) {
    const matchingIngredients = ingredientRows.filter(
      (ingredient) => Number(ingredient.menu_item_id) === orderItem.menuItemId
    );

    for (const ingredient of matchingIngredients) {
      const stockItemId = Number(ingredient.stock_item_id);
      const deduction = (Number(ingredient.quantity) || 0) * orderItem.quantity;

      if (!stockItemId || deduction <= 0) continue;

      const currentDeduction = deductions.get(stockItemId) || {
        stockItemId,
        name: ingredient.stock_name,
        stock: Number(ingredient.stock || 0),
        unit: ingredient.stock_unit || "",
        averageCost: Number(ingredient.unit_cost || 0),
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
