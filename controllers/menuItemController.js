const createHttpError = require("http-errors");
const fs = require("fs/promises");
const path = require("path");
const MenuItem = require("../models/menuItemModel");
const { emitRealtimeEvent } = require("../config/socket");

const localMenuImagePrefix = "/uploads/menu/";
const menuUploadDir = path.resolve(__dirname, "..", "uploads", "menu");

const removeLocalMenuImage = async (imagePath) => {
  if (
    typeof imagePath !== "string" ||
    !imagePath.startsWith(localMenuImagePrefix)
  ) {
    return;
  }

  const fileName = path.posix.basename(imagePath);
  const filePath = path.resolve(menuUploadDir, fileName);

  if (path.dirname(filePath) !== menuUploadDir) return;

  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
};

const removeImageIfUnused = async (oldImagePath, nextImagePath = null) => {
  if (!oldImagePath || oldImagePath === nextImagePath) return;

  const referenceCount =
    await MenuItem.countImagePathReferences(oldImagePath);
  if (referenceCount === 0) {
    await removeLocalMenuImage(oldImagePath);
  }
};

const requireAdmin = (req, next) => {
  if (req.user?.role?.toLowerCase() !== "admin") {
    return createHttpError(403, "Only admin can manage menu items!");
  }

  return null;
};

const getFirstSizePrice = (sizes) => {
  if (!Array.isArray(sizes)) return undefined;
  const firstSize = sizes.find((size) => size?.price !== undefined);
  return firstSize?.price;
};

const addMenuItem = async (req, res, next) => {
  try {
    const permissionError = requireAdmin(req, next);
    if (permissionError) return next(permissionError);

    const {
      categoryId,
      name,
      price,
      regularPrice,
      largePrice,
      variants,
      sizes,
      imagePath,
      isAvailable,
    } =
      req.body;
    const basePrice =
      regularPrice === undefined
        ? price === undefined
          ? getFirstSizePrice(sizes)
          : price
        : regularPrice;

    if (!categoryId || !name || basePrice === undefined) {
      return next(createHttpError(400, "Category, name, and price are required!"));
    }

    const menuItem = await MenuItem.create({
      categoryId,
      name,
      price: basePrice,
      regularPrice: basePrice,
      largePrice,
      variants,
      sizes,
      imagePath,
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
    const {
      categoryId,
      name,
      price,
      regularPrice,
      largePrice,
      variants,
      sizes,
      imagePath,
      isAvailable = true,
    } =
      req.body;
    const basePrice =
      regularPrice === undefined
        ? price === undefined
          ? getFirstSizePrice(sizes)
          : price
        : regularPrice;

    if (!Number(id)) {
      return next(createHttpError(404, "Invalid id!"));
    }

    if (!categoryId || !name || basePrice === undefined) {
      return next(createHttpError(400, "Category, name, and price are required!"));
    }

    const previousMenuItem = await MenuItem.findById(id);
    if (!previousMenuItem) {
      return next(createHttpError(404, "Menu item not found!"));
    }

    const menuItem = await MenuItem.update(id, {
      categoryId,
      name,
      price: basePrice,
      regularPrice: basePrice,
      largePrice,
      variants,
      sizes,
      imagePath,
      isAvailable,
    });

    if (!menuItem) {
      return next(createHttpError(404, "Menu item not found!"));
    }

    await removeImageIfUnused(previousMenuItem.imagePath, menuItem.imagePath);

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

    const menuItem = await MenuItem.findById(id);
    if (!menuItem) {
      return next(createHttpError(404, "Menu item not found!"));
    }

    const deleted = await MenuItem.remove(id);

    if (!deleted) {
      return next(createHttpError(404, "Menu item not found!"));
    }

    await removeImageIfUnused(menuItem.imagePath);

    emitRealtimeEvent("menu:changed", {
      action: "menu-item-deleted",
      menuItemId: Number(id),
    });
    res.status(200).json({ success: true, message: "Menu item deleted!" });
  } catch (error) {
    next(error);
  }
};

const uploadMenuImage = async (req, res, next) => {
  try {
    const permissionError = requireAdmin(req, next);
    if (permissionError) return next(permissionError);

    if (!req.file) {
      return next(createHttpError(400, "Image file is required!"));
    }

    res.status(201).json({
      success: true,
      message: "Image uploaded!",
      data: {
        imagePath: `/uploads/menu/${req.file.filename}`,
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  addMenuItem,
  deleteMenuItem,
  getMenuItems,
  uploadMenuImage,
  updateMenuItem,
};
