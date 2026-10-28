// Recipe-driven stock movements. Orders pass recipe lines
// ({ menuItemId, quantity }); each menu item's recipe rows (recipes, quantities
// in the stock item's unit) are applied to stock_items inside the caller's
// transaction connection. A prepared item in a recipe (e.g. Nasi) is not
// stocked itself: its components (Beras) are used in proportion to its yield.
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
       si.is_unlimited,
       si.is_prepared,
       si.yield_quantity
     FROM recipes r
     JOIN stock_items si ON si.id = r.stock_item_id
     WHERE r.menu_item_id IN (?)
     ORDER BY r.sort_order ASC, r.id ASC`,
    [menuItemIds]
  );

  if (!ingredientRows.length) return new Map();

  const preparedIds = [
    ...new Set(
      ingredientRows
        .filter((ingredient) => ingredient.is_prepared)
        .map((ingredient) => Number(ingredient.stock_item_id))
    ),
  ];
  const componentsByPreparedId = new Map();
  if (preparedIds.length) {
    const [componentRows] = await connection.query(
      `SELECT
         pr.prepared_item_id,
         pr.stock_item_id,
         pr.quantity,
         si.name AS stock_name,
         si.stock,
         si.unit AS stock_unit,
         si.unit_cost,
         si.is_unlimited
       FROM prepared_item_recipes pr
       JOIN stock_items si ON si.id = pr.stock_item_id
       WHERE pr.prepared_item_id IN (?)
       ORDER BY pr.sort_order ASC, pr.id ASC`,
      [preparedIds]
    );
    for (const component of componentRows) {
      const id = Number(component.prepared_item_id);
      if (!componentsByPreparedId.has(id)) componentsByPreparedId.set(id, []);
      componentsByPreparedId.get(id).push(component);
    }
  }

  // Stock rows one portion of a recipe line uses, with their quantities.
  const toStockLines = (ingredient) => {
    const quantity = Number(ingredient.quantity) || 0;
    if (!ingredient.is_prepared) return [{ row: ingredient, quantity }];

    const yieldQuantity = Number(ingredient.yield_quantity) || 1;
    return (componentsByPreparedId.get(Number(ingredient.stock_item_id)) || []).map(
      (component) => ({
        row: component,
        quantity: (quantity * (Number(component.quantity) || 0)) / yieldQuantity,
      })
    );
  };

  const deductions = new Map();

  for (const orderItem of orderItems) {
    const matchingIngredients = ingredientRows.filter(
      (ingredient) => Number(ingredient.menu_item_id) === orderItem.menuItemId
    );

    for (const line of matchingIngredients.flatMap(toStockLines)) {
      const stockItemId = Number(line.row.stock_item_id);
      const deduction = line.quantity * orderItem.quantity;

      if (!stockItemId || deduction <= 0) continue;

      const currentDeduction = deductions.get(stockItemId) || {
        stockItemId,
        name: line.row.stock_name,
        stock: Number(line.row.stock || 0),
        unit: line.row.stock_unit || "",
        averageCost: Number(line.row.unit_cost || 0),
        isUnlimited: Boolean(line.row.is_unlimited),
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
