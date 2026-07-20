const createHttpError = require("http-errors");
const MenuItem = require("../models/menuItemModel");
const { emitRealtimeEvent } = require("../config/socket");

const requireAdmin = (req, next) => {
  if (req.user?.role?.toLowerCase() !== "admin") {
    return createHttpError(403, "Only admin can manage menu items!");
  }

  return null;
};

const addMenuItem = async (req, res, next) => {
  try {
    const permissionError = requireAdmin(req, next);
    if (permissionError) return next(permissionError);

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

    emitRealtimeEvent("menu:changed", {
      action: "menu-item-created",
      menuItemId: menuItem.id || menuItem._id,
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
    const { categoryId, includeUnavailable: includeUnavailableQuery } = req.query;
    const includeUnavailable =
      includeUnavailableQuery === "true" &&
      req.user?.role?.toLowerCase() === "admin";
    const menuItems = categoryId
      ? await MenuItem.findByCategoryId(categoryId, { includeUnavailable })
      : await MenuItem.findAll({ includeUnavailable });

    res.status(200).json({ success: true, data: menuItems });
  } catch (error) {
    next(error);
  }
};

const updateMenuItem = async (req, res, next) => {
  try {
    const permissionError = requireAdmin(req, next);
    if (permissionError) return next(permissionError);

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

    emitRealtimeEvent("menu:changed", {
      action: "menu-item-updated",
      menuItemId: menuItem.id || menuItem._id,
    });
    res
      .status(200)
      .json({ success: true, message: "Menu item updated!", data: menuItem });
  } catch (error) {
    next(error);
  }
};

const deleteMenuItem = async (req, res, next) => {
  try {
    const permissionError = requireAdmin(req, next);
    if (permissionError) return next(permissionError);

    const { id } = req.params;

    if (!Number(id)) {
      return next(createHttpError(404, "Invalid id!"));
    }

    const deleted = await MenuItem.remove(id);

    if (!deleted) {
      return next(createHttpError(404, "Menu item not found!"));
    }

    emitRealtimeEvent("menu:changed", {
      action: "menu-item-deleted",
      menuItemId: Number(id),
    });
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
