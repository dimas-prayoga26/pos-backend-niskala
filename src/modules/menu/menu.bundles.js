// Kategori Promo: a menu of a promo category (categories.is_bundle)
// is a package of other menus (menu_item_bundle_items), each with a whole
// quantity, instead of a recipe. Packages hold ordinary menus only.
// A package can also hold choices (menu_item_bundle_choices): N menus of an
// ordinary category, picked by the cashier when ordering (e.g. 2 x Coffee).
const createHttpError = require("http-errors");

// [{ menuItemId, quantity }] with repeats summed; lines without a menu or
// with a quantity below 1 are dropped.
const normalizeBundleItems = (items) => {
  const byMenu = new Map();

  (Array.isArray(items) ? items : []).forEach((item) => {
    const menuItemId = Number(item?.menuItemId || item?.menu_item_id) || 0;
    const quantity = Math.round(Number(item?.quantity ?? 1));
    if (menuItemId <= 0 || !Number.isFinite(quantity) || quantity < 1) return;

    byMenu.set(menuItemId, (byMenu.get(menuItemId) || 0) + quantity);
  });

  return [...byMenu].map(([menuItemId, quantity]) => ({ menuItemId, quantity }));
};

// [{ categoryId, quantity, menuItemIds }] with repeats summed, like
// normalizeBundleItems. menuItemIds: the menus the choice offers (none: every
// menu of its category).
const normalizeBundleChoices = (choices) => {
  const byCategory = new Map();

  (Array.isArray(choices) ? choices : []).forEach((choice) => {
    const categoryId = Number(choice?.categoryId || choice?.category_id) || 0;
    const quantity = Math.round(Number(choice?.quantity ?? 1));
    if (categoryId <= 0 || !Number.isFinite(quantity) || quantity < 1) return;

    const current = byCategory.get(categoryId) || { quantity: 0, menuItemIds: new Set() };
    current.quantity += quantity;
    (Array.isArray(choice?.menuItemIds) ? choice.menuItemIds : [])
      .map(Number)
      .filter((id) => Number.isInteger(id) && id > 0)
      .forEach((id) => current.menuItemIds.add(id));
    byCategory.set(categoryId, current);
  });

  return [...byCategory].map(([categoryId, { quantity, menuItemIds }]) => ({
    categoryId,
    quantity,
    menuItemIds: [...menuItemIds],
  }));
};

const isBundleCategory = async (connection, categoryId) => {
  const [[row]] = await connection.query("SELECT is_bundle FROM categories WHERE id = ?", [categoryId]);
  return Boolean(row?.is_bundle);
};

// Packages (names) that contain the menu or offer it in a choice.
const findBundleNamesUsing = async (connection, menuItemId) => {
  const [rows] = await connection.query(
    `SELECT b.name
     FROM menu_item_bundle_items bi
     JOIN menu_items b ON b.id = bi.bundle_menu_item_id
     WHERE bi.menu_item_id = ?
     UNION
     SELECT b.name
     FROM menu_item_bundle_choice_menus bcm
     JOIN menu_item_bundle_choices bc ON bc.id = bcm.bundle_choice_id
     JOIN menu_items b ON b.id = bc.bundle_menu_item_id
     WHERE bcm.menu_item_id = ?
     ORDER BY name ASC`,
    [menuItemId, menuItemId]
  );
  return rows.map((row) => row.name);
};

// Package rows (bundle_menu_item_id, menu_item_id, quantity, name) of the
// menus that are packages, for selling them.
const findBundleRows = async (connection, menuItemIds) => {
  if (!menuItemIds.length) return [];

  const [rows] = await connection.query(
    `SELECT bi.bundle_menu_item_id, bi.menu_item_id, bi.quantity, mi.name
     FROM menu_item_bundle_items bi
     JOIN menu_items mi ON mi.id = bi.menu_item_id
     WHERE bi.bundle_menu_item_id IN (?)
     ORDER BY bi.sort_order ASC, bi.id ASC`,
    [menuItemIds]
  );
  return rows;
};

// Choices of packages (bundle_menu_item_id, category_id, quantity, category
// name, menuItemIds offered; none: every menu of the category), in their order.
const findBundleChoices = async (connection, bundleIds) => {
  if (!bundleIds.length) return [];

  const [rows] = await connection.query(
    `SELECT bc.id, bc.bundle_menu_item_id, bc.category_id, bc.quantity, c.name AS category_name,
            GROUP_CONCAT(bcm.menu_item_id ORDER BY bcm.id) AS menu_item_ids
     FROM menu_item_bundle_choices bc
     JOIN categories c ON c.id = bc.category_id
     LEFT JOIN menu_item_bundle_choice_menus bcm ON bcm.bundle_choice_id = bc.id
     WHERE bc.bundle_menu_item_id IN (?)
     GROUP BY bc.id, bc.bundle_menu_item_id, bc.category_id, bc.quantity, c.name, bc.sort_order
     ORDER BY bc.sort_order ASC, bc.id ASC`,
    [bundleIds]
  );
  return rows.map(({ menu_item_ids: menuItemIds, ...row }) => ({
    ...row,
    menuItemIds: menuItemIds ? String(menuItemIds).split(",").map(Number) : [],
  }));
};

// Contents of packages, in their order, with each menu's current price.
const findBundleItems = async (connection, bundleIds) => {
  if (!bundleIds.length) return [];

  const [rows] = await connection.query(
    `SELECT bi.id, bi.bundle_menu_item_id, bi.menu_item_id, bi.quantity, bi.sort_order,
            mi.name, mi.is_available, c.is_active AS category_is_active,
            mip.regular_price, mip.online_price, mip.hpp_cost
     FROM menu_item_bundle_items bi
     JOIN menu_items mi ON mi.id = bi.menu_item_id
     JOIN categories c ON c.id = mi.category_id
     LEFT JOIN menu_item_prices mip ON mip.menu_item_id = mi.id
     WHERE bi.bundle_menu_item_id IN (?)
     ORDER BY bi.sort_order ASC, bi.id ASC`,
    [bundleIds]
  );
  return rows;
};

// Choices may only offer ordinary categories.
const assertBundleChoices = async (connection, choices) => {
  if (!choices.length) return;

  const ids = choices.map((choice) => choice.categoryId);
  const [rows] = await connection.query(
    "SELECT id, name, is_bundle FROM categories WHERE id IN (?)",
    [ids]
  );
  if (rows.length !== ids.length) {
    throw createHttpError(400, "Category pilihan paket tidak ditemukan.");
  }
  const promos = rows.filter((row) => row.is_bundle);
  if (promos.length) {
    throw createHttpError(
      400,
      `Pilihan paket tidak bisa dari Kategori Promo: ${promos.map((row) => row.name).join(", ")}.`
    );
  }

  // The menus a choice offers are ordinary menus of its category.
  const offered = [...new Set(choices.flatMap((choice) => choice.menuItemIds))];
  if (!offered.length) return;

  const [menus] = await connection.query(
    `SELECT mi.id, mi.category_id,
            EXISTS (SELECT 1 FROM menu_item_bundle_items bi WHERE bi.bundle_menu_item_id = mi.id)
              OR EXISTS (SELECT 1 FROM menu_item_bundle_choices bc WHERE bc.bundle_menu_item_id = mi.id) AS is_package
     FROM menu_items mi
     WHERE mi.id IN (?)`,
    [offered]
  );
  const menuById = new Map(menus.map((menu) => [Number(menu.id), menu]));
  const fits = choices.every((choice) =>
    choice.menuItemIds.every((id) => {
      const menu = menuById.get(id);
      return menu && Number(menu.category_id) === choice.categoryId && !Number(menu.is_package);
    })
  );
  if (!fits) {
    throw createHttpError(400, "Menu pilihan paket harus menu biasa dari category pilihannya.");
  }
};

// Checks a package's contents (bundleId: the package when editing it):
// at least one portion (menus and choices), existing ordinary menus and
// categories only, never itself or another package, and the package is not
// itself inside a package.
const assertBundleItems = async (connection, bundleId, items, choices = []) => {
  const total = [...items, ...choices].reduce((sum, item) => sum + item.quantity, 0);
  if (total < 1) {
    throw createHttpError(400, "Paket minimal berisi 1 menu.");
  }
  if (bundleId && items.some((item) => item.menuItemId === Number(bundleId))) {
    throw createHttpError(400, "Paket tidak bisa berisi dirinya sendiri.");
  }
  await assertBundleChoices(connection, choices);
  if (bundleId) {
    const usedIn = await findBundleNamesUsing(connection, bundleId);
    if (usedIn.length) {
      throw createHttpError(
        400,
        `Menu ini dipakai di paket ${usedIn.join(", ")}, jadi tidak bisa dijadikan paket.`
      );
    }
  }
  if (!items.length) return;

  const ids = items.map((item) => item.menuItemId);
  const [rows] = await connection.query(
    `SELECT mi.id, mi.name, c.is_bundle,
            EXISTS (SELECT 1 FROM menu_item_bundle_items bi WHERE bi.bundle_menu_item_id = mi.id) AS has_items
     FROM menu_items mi
     JOIN categories c ON c.id = mi.category_id
     WHERE mi.id IN (?)`,
    [ids]
  );
  if (rows.length !== ids.length) {
    throw createHttpError(400, "Menu isi paket tidak ditemukan.");
  }
  const packages = rows.filter((row) => row.is_bundle || Number(row.has_items));
  if (packages.length) {
    throw createHttpError(
      400,
      `Paket tidak bisa berisi paket lain: ${packages.map((row) => row.name).join(", ")}.`
    );
  }
};

// The package's contents { items, choices, discountPercent } for a menu of a
// Kategori Promo (checked), or null for an ordinary menu. With a discount
// (0-100%) the package costs its menus' normal price less the percent.
const resolveBundleItems = async (
  connection,
  { categoryId, bundleItems, bundleChoices, discountPercent },
  bundleId = null
) => {
  if (!(await isBundleCategory(connection, categoryId))) return null;

  const items = normalizeBundleItems(bundleItems);
  const choices = normalizeBundleChoices(bundleChoices);
  await assertBundleItems(connection, bundleId, items, choices);
  return {
    items,
    choices,
    discountPercent: Math.min(Math.max(Number(discountPercent) || 0, 0), 100),
  };
};

const replaceBundleItems = async (connection, bundleId, { items = [], choices = [] } = {}) => {
  await connection.query("DELETE FROM menu_item_bundle_items WHERE bundle_menu_item_id = ?", [bundleId]);
  await connection.query("DELETE FROM menu_item_bundle_choices WHERE bundle_menu_item_id = ?", [bundleId]);

  if (items.length) {
    await connection.query(
      `INSERT INTO menu_item_bundle_items (bundle_menu_item_id, menu_item_id, quantity, sort_order)
       VALUES ?`,
      [items.map((item, index) => [bundleId, item.menuItemId, item.quantity, index + 1])]
    );
  }
  for (const [index, choice] of choices.entries()) {
    const [result] = await connection.query(
      `INSERT INTO menu_item_bundle_choices (bundle_menu_item_id, category_id, quantity, sort_order)
       VALUES (?, ?, ?, ?)`,
      [bundleId, choice.categoryId, choice.quantity, index + 1]
    );
    if (choice.menuItemIds?.length) {
      await connection.query(
        "INSERT INTO menu_item_bundle_choice_menus (bundle_choice_id, menu_item_id) VALUES ?",
        [choice.menuItemIds.map((menuItemId) => [result.insertId, menuItemId])]
      );
    }
  }
};

// The menus picked for the choices of one package of an order line:
// [{ menuItemId, name, quantity }] per package. Each choice needs exactly its
// quantity of ordinary menus from its category; a package without choices
// ignores picks.
const resolveOrderBundleChoices = async (connection, bundleId, picked) => {
  if (!bundleId) return [];

  const choices = await findBundleChoices(connection, [bundleId]);
  if (!choices.length) return [];

  const picks = normalizeBundleItems(picked);
  const [menus] = picks.length
    ? await connection.query(
        `SELECT mi.id, mi.name, mi.category_id
         FROM menu_items mi
         WHERE mi.id IN (?)
           AND NOT EXISTS (SELECT 1 FROM menu_item_bundle_items bi WHERE bi.bundle_menu_item_id = mi.id)
           AND NOT EXISTS (SELECT 1 FROM menu_item_bundle_choices bc WHERE bc.bundle_menu_item_id = mi.id)`,
        [picks.map((pick) => pick.menuItemId)]
      )
    : [[]];
  const menuById = new Map(menus.map((menu) => [Number(menu.id), menu]));

  const pickedPerChoice = new Map();
  for (const pick of picks) {
    const menu = menuById.get(pick.menuItemId);
    const choice =
      menu && choices.find((row) => Number(row.category_id) === Number(menu.category_id));
    if (
      !choice ||
      (choice.menuItemIds.length && !choice.menuItemIds.includes(pick.menuItemId))
    ) {
      throw createHttpError(400, "Menu pilihan paket tidak sesuai category paket.");
    }
    pickedPerChoice.set(choice.id, (pickedPerChoice.get(choice.id) || 0) + pick.quantity);
  }

  const [[bundle]] = await connection.query("SELECT name FROM menu_items WHERE id = ?", [bundleId]);
  for (const choice of choices) {
    if ((pickedPerChoice.get(choice.id) || 0) !== Number(choice.quantity)) {
      throw createHttpError(
        400,
        `Pilih ${choice.quantity} menu ${choice.category_name} untuk ${bundle?.name || "paket"}.`
      );
    }
  }

  return picks.map((pick) => ({
    menuItemId: pick.menuItemId,
    name: menuById.get(pick.menuItemId).name,
    quantity: pick.quantity,
  }));
};

module.exports = {
  findBundleChoices,
  findBundleItems,
  findBundleRows,
  findBundleNamesUsing,
  normalizeBundleChoices,
  normalizeBundleItems,
  replaceBundleItems,
  resolveBundleItems,
  resolveOrderBundleChoices,
};
