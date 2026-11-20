const createHttpError = require("http-errors");
const { pool, withTransaction } = require("../../infrastructure/database/pool");
const {
  findBundleNamesUsing,
  replaceBundleItems,
  resolveBundleItems,
} = require("./menu.bundles");
const { refreshMenuCosts } = require("./menu.costs");
const { removeImageIfUnused } = require("./menu.images");
const { buildMenuItemRecord } = require("./menu.pricing");
const MenuItem = require("./menu.repository");

// Validates the request and returns the base price.
const resolveBasePrice = ({ categoryId, name, price, regularPrice }) => {
  const basePrice = regularPrice === undefined ? price : regularPrice;

  if (!categoryId || !name || basePrice === undefined) {
    throw createHttpError(400, "Category, name, and price are required!");
  }

  return basePrice;
};

const toMenuItemRecord = (input) => {
  const basePrice = resolveBasePrice(input);

  return {
    ...buildMenuItemRecord({ ...input, price: basePrice, regularPrice: basePrice }),
    categoryId: input.categoryId,
    name: input.name,
    imagePath: input.imagePath,
    // Only an omitted flag defaults to available; an explicit null stays falsy.
    isAvailable: input.isAvailable === undefined ? true : input.isAvailable,
  };
};

// Promo loyalty (Jenis promo in the menu form): a free promo (Harga 0,
// Diskon 100%) of a Kategori Promo, given by Tukar for a loyalty reward and
// hidden from the POS grid. Which reward uses it is set in Program
// Promo (the loyalty app). false for any other menu.
const resolveLoyaltyPromo = (input, bundle) => {
  const flag = input.isLoyaltyPromo;
  if (!(flag === true || flag === "true" || flag === 1 || flag === "1")) return false;

  if (!bundle) {
    throw createHttpError(400, "Promo loyalty hanya untuk menu Kategori Promo.");
  }
  const price = Number(input.regularPrice ?? input.price);
  if (price !== 0 || Number(bundle.discountPercent) !== 100) {
    throw createHttpError(400, "Promo loyalty harus Harga 0 dan Diskon 100%.");
  }

  return true;
};

// Marks the record Promo loyalty or not. A reward's gross profit is kept at
// 0: it is given away, and each Tukar still records the HPP of the menu
// picked (order snapshot).
const applyLoyaltyPromo = (record, input, bundle) => {
  record.isLoyaltyPromo = resolveLoyaltyPromo(input, bundle);
  if (record.isLoyaltyPromo) record.profitFields = { ...record.profitFields, grossProfit: 0 };
};

// A package (bundle { items, choices } set) has no recipe of its own: selling
// it sells the recipes of its menus. An ordinary menu loses any package contents.
const writePriceAndRecipe = async (connection, id, record, bundle) => {
  await MenuItem.replacePriceAndRecipe(connection, id, {
    price: {
      regularPrice: record.basePrice,
      onlinePrice: record.baseOnlinePrice,
      ...record.profitFields,
    },
    ingredients: bundle ? [] : record.normalizedIngredients,
  });
  await MenuItem.setDiscountPercent(connection, id, bundle?.discountPercent || 0);
  await replaceBundleItems(connection, id, bundle || {});
};

const create = async (input) => {
  const record = toMenuItemRecord(input);
  const id = await withTransaction(async (connection) => {
    const bundle = await resolveBundleItems(connection, input);
    applyLoyaltyPromo(record, input, bundle);
    const insertId = await MenuItem.insertMenuItem(connection, record);
    await writePriceAndRecipe(connection, insertId, record, bundle);
    await refreshMenuCosts(connection, { menuItemIds: [insertId] });
    return insertId;
  });

  return MenuItem.findById(id);
};

const update = async (id, input) => {
  const record = toMenuItemRecord(input);
  const previousMenuItem = await MenuItem.findById(id);
  if (!previousMenuItem) return null;

  await withTransaction(async (connection) => {
    const bundle = await resolveBundleItems(connection, input, id);
    applyLoyaltyPromo(record, input, bundle);
    await MenuItem.updateMenuItem(connection, id, record);
    await writePriceAndRecipe(connection, id, record, bundle);
    await refreshMenuCosts(connection, { menuItemIds: [id] });
  });

  const menuItem = await MenuItem.findById(id);
  if (!menuItem) return null;

  await removeImageIfUnused(previousMenuItem.imagePath, menuItem.imagePath);

  return menuItem;
};

// A menu inside a package cannot be deleted (409) until it leaves the package.
const remove = async (id) => {
  const menuItem = await MenuItem.findById(id);
  if (!menuItem) return false;

  const bundleNames = await findBundleNamesUsing(pool, id);
  if (bundleNames.length) {
    throw createHttpError(
      409,
      `Menu ini dipakai di paket ${bundleNames.join(", ")}. Hapus dari paket dulu.`
    );
  }

  const deleted = await MenuItem.remove(id);
  if (!deleted) return false;

  await removeImageIfUnused(menuItem.imagePath);

  return true;
};

module.exports = {
  create,
  findAll: MenuItem.findAll,
  findByCategoryId: MenuItem.findByCategoryId,
  remove,
  update,
};
