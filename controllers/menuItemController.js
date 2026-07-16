const createHttpError = require("http-errors");
const MenuItem = require("../models/menuItemModel");

const addMenuItem = async (req, res, next) => {
  try {
    const { categoryId, name, price, imageUrl, isAvailable } =
      req.body;

    if (!categoryId || !name || price === undefined) {
      return next(createHttpError(400, "Category, name, and price are required!"));
    }

    const menuItem = await MenuItem.create({
      categoryId,
      name,
      price,
      imageUrl,
      isAvailable,
    });

    res
      .status(201)
      .json({ success: true, message: "Menu item added!", data: menuItem });
  } catch (error) {
    next(error);
  }
};

const getMenuItems = async (req, res, next) => {
  try {
    const { categoryId } = req.query;
    const menuItems = categoryId
      ? await MenuItem.findByCategoryId(categoryId)
      : await MenuItem.findAll();

    res.status(200).json({ success: true, data: menuItems });
  } catch (error) {
    next(error);
  }
};

const updateMenuItem = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { categoryId, name, price, imageUrl, isAvailable = true } =
      req.body;

    if (!Number(id)) {
      return next(createHttpError(404, "Invalid id!"));
    }

    if (!categoryId || !name || price === undefined) {
      return next(createHttpError(400, "Category, name, and price are required!"));
    }

    const menuItem = await MenuItem.update(id, {
      categoryId,
      name,
      price,
      imageUrl,
      isAvailable,
    });

    if (!menuItem) {
      return next(createHttpError(404, "Menu item not found!"));
    }

    res
      .status(200)
      .json({ success: true, message: "Menu item updated!", data: menuItem });
  } catch (error) {
    next(error);
  }
};

const deleteMenuItem = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!Number(id)) {
      return next(createHttpError(404, "Invalid id!"));
    }

    const deleted = await MenuItem.remove(id);

    if (!deleted) {
      return next(createHttpError(404, "Menu item not found!"));
    }

    res.status(200).json({ success: true, message: "Menu item deleted!" });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  addMenuItem,
  deleteMenuItem,
  getMenuItems,
  updateMenuItem,
};
