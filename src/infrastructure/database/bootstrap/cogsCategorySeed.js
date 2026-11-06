// One-time move of the COGS sheet's menus into categories named after the
// sheet's tabs, in the sheet's order (Black Coffee ... Roti). It runs at boot
// until it has succeeded once (seed_runs):
// - a tab's category is reused when one with the same name exists ("Non
//   Coffee" = "Non-Coffee"), else created, and gets the tab's icon; the tab
//   categories come first in the POS, the other categories keep their order
//   after them;
// - each menu of the sheet found by name moves to its tab's category (a menu
//   on a Hot tab and its plain tab stays on the plain tab); menus that are
//   not on the sheet and Kategori Promo packages stay where they are;
// - a package choice that offered every menu of a category keeps offering
//   exactly those menus, and follows them to their new category when they
//   all moved to the same one;
// - a category left without menus is turned off (not deleted).
const logger = require("../../../shared/logger");
const { pool, withTransaction } = require("../pool");
const { cogsMenus } = require("./cogsSheetData");

const SEED_NAME = "cogs-categories-2026-11";

// The sheet's tabs from Black Coffee to Roti, with the menus of each.
const SHEET_CATEGORIES = [
  {
    name: "Black Coffee",
    icon: "\u2615\uFE0F",
    menus: ["Americano", "On The Rock Espresso", "Tropical Americano", "Elberry Americano", "Montblanc"],
  },
  { name: "Hot Black Coffee", icon: "\u{1F525}", menus: ["Longblack"] },
  {
    name: "White Coffee",
    icon: "\u{1F95B}",
    menus: [
      "Butterscotch Latte",
      "Caramel Latte",
      "Aren Latte",
      "Cafe Latte",
      "Cappuccino",
      "Berry Coffee Milk",
      "Niskala Coconut Coffee",
      "Salted Creamy Latte",
    ],
  },
  { name: "Hot White Coffee", icon: "\u2668\uFE0F", menus: ["Matcha Coffee"] },
  {
    name: "Matcha Series",
    icon: "\u{1F375}",
    menus: ["Matcha", "Matcha Pistachio", "Matcha Strawberry", "Matcha Blueberry"],
  },
  {
    name: "Non Coffee",
    icon: "\u{1F9CB}",
    menus: ["Chocolate", "Cookies and Cream", "Strawberry Milk", "Blueberry Milk", "Milo Dino"],
  },
  {
    name: "Tea Based",
    icon: "\u{1FAD6}",
    menus: ["Lychee Tea", "Lemon Tea", "Jeruk Nipis Songkit", "Thai Tea"],
  },
  { name: "Minuman Kaleng", icon: "\u{1F964}", menus: ["Sprite", "Coca-Cola"] },
  {
    name: "Snack",
    icon: "\u{1F35F}",
    menus: ["Kentang Goreng", "Mix Platter", "Cireng", "Pisang Nugget Keju Coklat"],
  },
  { name: "Nasi Goreng", icon: "\u{1F35B}", menus: ["Nasi Goreng Special", "Nasi Goreng Katsu"] },
  {
    name: "Rice Bowl",
    icon: "\u{1F35A}",
    menus: [
      "Fried Egg Rice Bowl",
      "Chicken Katsu Rice Bowl",
      "Chicken Teriyaki Rice Bowl",
      "Ayam Geprek Rice Bowl",
      "Indomie Goreng Telur",
      "Indomie Rebus Telur",
      "Ayam Salted Egg",
      "Ayam Black Pepper",
      "Ayam Sambel Orek",
      "Udang Salted",
      "Beef Teriyaki Rice Bowl",
      "Beef Basir",
    ],
  },
  {
    name: "Roti",
    icon: "\u{1F35E}",
    menus: ["Roti Kukus Coklat", "Roti Kukus Tiramisu", "Roti Kukus Strawberry", "Roti Kukus Slice"],
  },
];

// Names match ignoring case, spaces and punctuation ("Coca-Cola" = "COCA COLA").
const keyOf = (name) => String(name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const aliasesOf = new Map(cogsMenus.map((menu) => [keyOf(menu.name), menu.aliases || []]));

// { categoryId, name } of each sheet tab, reusing an ordinary category of the
// same name; tax follows the category its menus come from.
const resolveCategories = async (connection, categories, menus) => {
  const ordinaryByKey = new Map(
    categories.filter((category) => !category.is_bundle).map((category) => [keyOf(category.name), category])
  );
  const taxById = new Map(categories.map((category) => [Number(category.id), category.tax]));
  const resolved = [];

  for (const sheetCategory of SHEET_CATEGORIES) {
    const existing = ordinaryByKey.get(keyOf(sheetCategory.name));
    if (existing) {
      await connection.query("UPDATE categories SET icon = ? WHERE id = ?", [sheetCategory.icon, existing.id]);
      resolved.push({ ...sheetCategory, categoryId: Number(existing.id) });
      continue;
    }

    const sourceTax = menus
      .filter((menu) => menu.target === sheetCategory.name)
      .map((menu) => taxById.get(menu.categoryId))
      .find((tax) => tax !== null && tax !== undefined);
    const [result] = await connection.query(
      "INSERT INTO categories (name, icon, tax, is_active, sort_order) VALUES (?, ?, ?, TRUE, 0)",
      [sheetCategory.name, sheetCategory.icon, sourceTax ?? null]
    );
    resolved.push({ ...sheetCategory, categoryId: result.insertId });
  }

  return resolved;
};

// The sheet's menus found in the database: { id, categoryId, target }.
const findSheetMenus = (menuRows, promoCategoryIds) => {
  const menuByKey = new Map(menuRows.map((row) => [keyOf(row.name), row]));
  const found = [];

  for (const sheetCategory of SHEET_CATEGORIES) {
    for (const name of sheetCategory.menus) {
      const row = [name, ...(aliasesOf.get(keyOf(name)) || [])]
        .map((candidate) => menuByKey.get(keyOf(candidate)))
        .find(Boolean);
      if (!row || promoCategoryIds.has(Number(row.category_id))) continue;

      found.push({ id: Number(row.id), categoryId: Number(row.category_id), target: sheetCategory.name });
    }
  }
  return found;
};

// Choices offering a whole category that loses menus now list those menus.
const pinChoiceMenus = async (connection, sourceCategoryIds) => {
  if (!sourceCategoryIds.length) return 0;

  const [choices] = await connection.query(
    `SELECT bc.id, bc.category_id
     FROM menu_item_bundle_choices bc
     WHERE bc.category_id IN (?)
       AND NOT EXISTS (SELECT 1 FROM menu_item_bundle_choice_menus o WHERE o.bundle_choice_id = bc.id)`,
    [sourceCategoryIds]
  );
  for (const choice of choices) {
    await connection.query(
      `INSERT INTO menu_item_bundle_choice_menus (bundle_choice_id, menu_item_id)
       SELECT ?, mi.id
       FROM menu_items mi
       WHERE mi.category_id = ?
         AND NOT EXISTS (SELECT 1 FROM menu_item_bundle_items bi WHERE bi.bundle_menu_item_id = mi.id)
         AND NOT EXISTS (SELECT 1 FROM menu_item_bundle_choices c WHERE c.bundle_menu_item_id = mi.id)`,
      [choice.id, choice.category_id]
    );
  }
  return choices.length;
};

// A choice whose menus all sit in one other category now names that one,
// unless its package already has a choice there.
const followChoiceMenus = async (connection) => {
  const [rows] = await connection.query(
    `SELECT bc.id, bc.bundle_menu_item_id, bc.category_id,
            MIN(mi.category_id) AS only_category_id, COUNT(DISTINCT mi.category_id) AS categories
     FROM menu_item_bundle_choices bc
     JOIN menu_item_bundle_choice_menus o ON o.bundle_choice_id = bc.id
     JOIN menu_items mi ON mi.id = o.menu_item_id
     GROUP BY bc.id, bc.bundle_menu_item_id, bc.category_id`
  );
  let moved = 0;
  for (const row of rows) {
    const target = Number(row.only_category_id);
    if (Number(row.categories) !== 1 || target === Number(row.category_id)) continue;

    const [[taken]] = await connection.query(
      "SELECT COUNT(*) AS n FROM menu_item_bundle_choices WHERE bundle_menu_item_id = ? AND category_id = ?",
      [row.bundle_menu_item_id, target]
    );
    if (Number(taken.n)) continue;

    await connection.query("UPDATE menu_item_bundle_choices SET category_id = ? WHERE id = ?", [target, row.id]);
    moved += 1;
  }
  return moved;
};

// The tab categories first in the sheet's order, then the others as they were.
const reorderCategories = async (connection, sheetCategoryIds) => {
  const [rows] = await connection.query(
    `SELECT id FROM categories
     ORDER BY CASE WHEN sort_order > 0 THEN sort_order ELSE 9999 END, id`
  );
  const sheetIds = new Set(sheetCategoryIds);
  const order = [...sheetCategoryIds, ...rows.map((row) => Number(row.id)).filter((id) => !sheetIds.has(id))];
  for (const [index, id] of order.entries()) {
    await connection.query("UPDATE categories SET sort_order = ? WHERE id = ?", [index + 1, id]);
  }
};

const arrangeCategories = async (connection) => {
  const [categories] = await connection.query("SELECT id, name, tax, is_bundle FROM categories");
  const promoCategoryIds = new Set(
    categories.filter((category) => category.is_bundle).map((category) => Number(category.id))
  );
  const [menuRows] = await connection.query("SELECT id, name, category_id FROM menu_items");
  const menus = findSheetMenus(menuRows, promoCategoryIds);
  const resolved = await resolveCategories(connection, categories, menus);
  const categoryIdOf = new Map(resolved.map((category) => [category.name, category.categoryId]));

  const moving = menus.filter((menu) => categoryIdOf.get(menu.target) !== menu.categoryId);
  const sourceCategoryIds = [...new Set(moving.map((menu) => menu.categoryId))];
  const pinnedChoices = await pinChoiceMenus(connection, sourceCategoryIds);

  for (const menu of moving) {
    await connection.query("UPDATE menu_items SET category_id = ? WHERE id = ?", [
      categoryIdOf.get(menu.target),
      menu.id,
    ]);
  }
  const followedChoices = await followChoiceMenus(connection);

  const sheetCategoryIds = resolved.map((category) => category.categoryId);
  const emptied = sourceCategoryIds.filter((id) => !sheetCategoryIds.includes(id));
  let turnedOff = [];
  if (emptied.length) {
    const [empty] = await connection.query(
      `SELECT c.id, c.name FROM categories c
       WHERE c.id IN (?) AND c.is_active = TRUE
         AND NOT EXISTS (SELECT 1 FROM menu_items mi WHERE mi.category_id = c.id)`,
      [emptied]
    );
    turnedOff = empty.map((row) => row.name);
    if (empty.length) {
      await connection.query("UPDATE categories SET is_active = FALSE WHERE id IN (?)", [
        empty.map((row) => row.id),
      ]);
    }
  }
  await reorderCategories(connection, sheetCategoryIds);

  return { moved: moving.length, pinnedChoices, followedChoices, turnedOff };
};

// Runs once per database. A failure is logged and retried on the next boot
// instead of stopping the server.
const seedCogsCategories = async () => {
  await pool.query(`CREATE TABLE IF NOT EXISTS seed_runs (
    name VARCHAR(100) PRIMARY KEY,
    ran_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);
  const [done] = await pool.query("SELECT name FROM seed_runs WHERE name = ?", [SEED_NAME]);
  if (done.length) return null;

  try {
    const summary = await withTransaction(async (connection) => {
      // Claimed first, so a second process booting at the same time stops here.
      await connection.query("INSERT INTO seed_runs (name) VALUES (?)", [SEED_NAME]);
      return arrangeCategories(connection);
    });

    logger.info("COGS sheet categories arranged", { seed: SEED_NAME, ...summary });
    return summary;
  } catch (error) {
    if (error.code !== "ER_DUP_ENTRY") {
      logger.error("COGS category seed failed; retried on the next boot", { error: error.message });
    }
    return null;
  }
};

module.exports = { SEED_NAME, SHEET_CATEGORIES, seedCogsCategories };
