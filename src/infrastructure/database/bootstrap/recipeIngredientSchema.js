// stock_raw_items.is_recipe_ingredient ("Bahan Resep"): whether a bahan baku
// is offered in the recipe editors (menu recipes and bahan setengah jadi).
// When the column is added, the bahan a recipe already uses are bahan resep and
// the rest (Aqua galon, kemasan, ...) are not. Runs after the recipe tables
// exist (menu_item_recipes, stock_semi_item_recipes).
const tablesOf = async (db, names) => {
  const [rows] = await db.query(
    `SELECT table_name AS name FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name IN (?)`,
    [names]
  );
  return new Set(rows.map((row) => row.name));
};

const ensureRecipeIngredientSchema = async (db) => {
  const [columns] = await db.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'stock_raw_items' AND column_name = 'is_recipe_ingredient'`
  );
  if (columns.length) return;

  await db.query(
    "ALTER TABLE stock_raw_items ADD COLUMN is_recipe_ingredient BOOLEAN NOT NULL DEFAULT TRUE AFTER is_unlimited"
  );
  const recipeTables = await tablesOf(db, ["menu_item_recipes", "stock_semi_item_recipes"]);
  const usedBy = [...recipeTables].map((table) => `id IN (SELECT stock_item_id FROM ${table})`);
  await db.query(`UPDATE stock_raw_items SET is_recipe_ingredient = ${usedBy.length ? `(${usedBy.join(" OR ")})` : "FALSE"}`);
};

module.exports = { ensureRecipeIngredientSchema };
