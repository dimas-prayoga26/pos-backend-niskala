const createHttpError = require("http-errors");
const { withTransaction } = require("../../infrastructure/database/pool");
const { removeImageIfUnused } = require("./menu.images");
const { buildMenuItemRecord } = require("./menu.pricing");
const MenuItem = require("./menu.repository");

const hasSizeOptions = (sizes) =>
  Array.isArray(sizes) &&
  sizes.some((size) => String(size?.name || "").trim());

// Validates the request and returns the base price (null when sizes are used).
const resolveBasePrice = ({ categoryId, name, price, regularPrice, sizes }) => {
  const hasSizes = hasSizeOptions(sizes);
  const basePrice =
    hasSizes ? null : regularPrice === undefined ? price : regularPrice;

  if (!categoryId || !name || (!hasSizes && basePrice === undefined)) {
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

const writeOptions = (connection, id, record, variants) =>
  MenuItem.replaceOptions(connection, id, {
    sizes: record.normalizedSizes,
    variants,
    ingredients: record.normalizedIngredients,
  });

const create = async (input) => {
  const record = toMenuItemRecord(input);
  const id = await withTransaction(async (connection) => {
    const insertId = await MenuItem.insertMenuItem(connection, record);
    await writeOptions(connection, insertId, record, input.variants ?? []);
    return insertId;
  });

  return MenuItem.findById(id);
};

// Editing a seeded item opts it out of the boot-time catalog seed.
const update = async (id, input) => {
  const record = toMenuItemRecord(input);
  const previousMenuItem = await MenuItem.findById(id);
  if (!previousMenuItem) return null;

  await withTransaction(async (connection) => {
    await MenuItem.updateMenuItem(connection, id, record);
    await writeOptions(connection, id, record, input.variants ?? []);
  });

  const menuItem = await MenuItem.findById(id);
  if (!menuItem) return null;

  await MenuItem.excludeFromDefaultSeed([previousMenuItem.name, menuItem.name]);
  await removeImageIfUnused(previousMenuItem.imagePath, menuItem.imagePath);

  return menuItem;
};

// Deleted seeded items are excluded so the boot seed does not recreate them.
const remove = async (id) => {
  const menuItem = await MenuItem.findById(id);
  if (!menuItem) return false;

  const deleted = await MenuItem.remove(id);
  if (!deleted) return false;

  await MenuItem.excludeFromDefaultSeed(menuItem.name);
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
