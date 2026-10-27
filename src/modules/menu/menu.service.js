const createHttpError = require("http-errors");
const { withTransaction } = require("../../infrastructure/database/pool");
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

const writePriceAndRecipe = (connection, id, record) =>
  MenuItem.replacePriceAndRecipe(connection, id, {
    price: {
      regularPrice: record.basePrice,
      onlinePrice: record.baseOnlinePrice,
      ...record.profitFields,
    },
    ingredients: record.normalizedIngredients,
  });

const create = async (input) => {
  const record = toMenuItemRecord(input);
  const id = await withTransaction(async (connection) => {
    const insertId = await MenuItem.insertMenuItem(connection, record);
    await writePriceAndRecipe(connection, insertId, record);
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
    await MenuItem.updateMenuItem(connection, id, record);
    await writePriceAndRecipe(connection, id, record);
    await refreshMenuCosts(connection, { menuItemIds: [id] });
  });

  const menuItem = await MenuItem.findById(id);
  if (!menuItem) return null;

  await removeImageIfUnused(previousMenuItem.imagePath, menuItem.imagePath);

  return menuItem;
};

const remove = async (id) => {
  const menuItem = await MenuItem.findById(id);
  if (!menuItem) return false;

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
