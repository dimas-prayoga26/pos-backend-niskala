// Kategori Promo: a menu of a promo category (categories.is_bundle)
// is a package of other menus (menu_item_bundle_items), each with a whole
// quantity, instead of a recipe. Packages hold ordinary menus only.
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

const isBundleCategory = async (connection, categoryId) => {
  const [[row]] = await connection.query("SELECT is_bundle FROM categories WHERE id = ?", [categoryId]);
  return Boolean(row?.is_bundle);
};

// Packages (names) that contain the menu.
const findBundleNamesUsing = async (connection, menuItemId) => {
  const [rows] = await connection.query(
    `SELECT DISTINCT b.name
     FROM menu_item_bundle_items bi
     JOIN menu_items b ON b.id = bi.bundle_menu_item_id
     WHERE bi.menu_item_id = ?
     ORDER BY b.name ASC`,
    [menuItemId]
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

// Checks a package's contents (bundleId: the package when editing it):
// at least two portions, existing ordinary menus only, never itself or another
// package, and the package is not itself inside a package.
const assertBundleItems = async (connection, bundleId, items) => {
  const total = items.reduce((sum, item) => sum + item.quantity, 0);
  if (total < 2) {
    throw createHttpError(400, "Paket minimal berisi 2 menu.");
  }
  if (bundleId && items.some((item) => item.menuItemId === Number(bundleId))) {
    throw createHttpError(400, "Paket tidak bisa berisi dirinya sendiri.");
  }

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

  if (bundleId) {
    const usedIn = await findBundleNamesUsing(connection, bundleId);
    if (usedIn.length) {
      throw createHttpError(
        400,
        `Menu ini dipakai di paket ${usedIn.join(", ")}, jadi tidak bisa dijadikan paket.`
      );
    }
  }
};

// The package's contents for a menu of a Kategori Promo (checked),
// or null for an ordinary menu.
const resolveBundleItems = async (connection, { categoryId, bundleItems }, bundleId = null) => {
  if (!(await isBundleCategory(connection, categoryId))) return null;

  const items = normalizeBundleItems(bundleItems);
  await assertBundleItems(connection, bundleId, items);
  return items;
};

const replaceBundleItems = async (connection, bundleId, items) => {
  await connection.query("DELETE FROM menu_item_bundle_items WHERE bundle_menu_item_id = ?", [bundleId]);
  if (!items.length) return;

  await connection.query(
    `INSERT INTO menu_item_bundle_items (bundle_menu_item_id, menu_item_id, quantity, sort_order)
     VALUES ?`,
    [items.map((item, index) => [bundleId, item.menuItemId, item.quantity, index + 1])]
  );
};

module.exports = {
  findBundleItems,
  findBundleRows,
  findBundleNamesUsing,
  normalizeBundleItems,
  replaceBundleItems,
  resolveBundleItems,
};
