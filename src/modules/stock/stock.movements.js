// Recipe-driven stock movements. Orders pass recipe lines
// ({ menuItemId, quantity }); each menu item's recipe rows (menu_item_recipes, quantities
// in the item's unit) are applied to stock_raw_items (bahan baku) or
// stock_semi_items (bahan setengah jadi) inside the caller's transaction
// connection.
const createHttpError = require("http-errors");
const { roundCurrency } = require("../../shared/utils/money");
const { findRecipeLines } = require("../menu/menu.recipeLines");

const createStockValidationError = (insufficientStock) =>
  createHttpError(409, "Stok bahan tidak mencukupi.", {
    details: { insufficientStock },
  });

// Semi items have no is_unlimited; only raw items can skip stock.
const STOCK_UPDATES = {
  raw: (sign) => `UPDATE stock_raw_items
     SET stock = CASE
       WHEN is_unlimited = TRUE THEN stock
       ELSE stock ${sign} ?
     END,
     stock_value = CASE
       WHEN is_unlimited = TRUE THEN stock_value
       ELSE ${sign === "-" ? "GREATEST(stock_value - ?, 0)" : "stock_value + ?"}
     END
     WHERE id = ?`,
  semi: (sign) => `UPDATE stock_semi_items
     SET stock = stock ${sign} ?,
         stock_value = ${sign === "-" ? "GREATEST(stock_value - ?, 0)" : "stock_value + ?"}
     WHERE id = ?`,
};

const buildStockDeductions = async (connection, orderItems = []) => {
  if (!orderItems.length) return new Map();

  const menuItemIds = [...new Set(orderItems.map((item) => item.menuItemId))];
  // Bahan baku lines live in menu_item_recipes, bahan setengah jadi lines in
  // stock_semi_item_menus.
  const ingredientRows = await findRecipeLines(connection, menuItemIds);

  if (!ingredientRows.length) return new Map();

  const deductions = new Map();

  for (const orderItem of orderItems) {
    const matchingIngredients = ingredientRows.filter(
      (ingredient) => Number(ingredient.menu_item_id) === orderItem.menuItemId
    );

    for (const ingredient of matchingIngredients) {
      const { kind } = ingredient;
      const itemId = Number(kind === "semi" ? ingredient.semi_item_id : ingredient.stock_item_id);
      const deduction = (Number(ingredient.quantity) || 0) * orderItem.quantity;

      if (!itemId || deduction <= 0) continue;

      const key = `${kind}:${itemId}`;
      const currentDeduction = deductions.get(key) || {
        kind,
        itemId,
        name: ingredient.name,
        stock: Number(ingredient.stock || 0),
        unit: ingredient.unit || "",
        averageCost: Number(ingredient.unit_cost || 0),
        isUnlimited: Boolean(ingredient.is_unlimited),
        required: 0,
        requiredValue: 0,
      };

      currentDeduction.required += deduction;
      currentDeduction.requiredValue += roundCurrency(
        deduction * currentDeduction.averageCost
      );
      deductions.set(key, currentDeduction);
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
      [deduction.kind === "semi" ? "semiItemId" : "stockItemId"]: deduction.itemId,
      name: deduction.name,
      stock: deduction.stock,
      required: deduction.required,
      shortage: deduction.required - deduction.stock,
      unit: deduction.unit,
    }));

const applyStockMovements = async (connection, deductions, sign) => {
  for (const deduction of deductions.values()) {
    await connection.query(STOCK_UPDATES[deduction.kind](sign), [
      deduction.required,
      deduction.requiredValue,
      deduction.itemId,
    ]);
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

  return applyStockMovements(connection, deductions, "-");
};

const restoreIngredientStock = async (connection, items = []) => {
  const deductions = await buildStockDeductions(connection, items);
  if (!deductions.size) return 0;

  return applyStockMovements(connection, deductions, "+");
};

module.exports = {
  deductIngredientStock,
  restoreIngredientStock,
};
