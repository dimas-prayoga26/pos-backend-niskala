const createHttpError = require("http-errors");
const { emitRealtimeEvent } = require("../../infrastructure/realtime/socket");
const asyncHandler = require("../../shared/http/asyncHandler");
const { isAdmin } = require("../../shared/middleware/authorize");
const menuService = require("./menu.service");

const getMenuItems = asyncHandler(async (req, res) => {
  const { categoryId } = req.query;
  const includeUnavailable = req.query.includeUnavailable === "true" && isAdmin(req);
  const menuItems = categoryId
    ? await menuService.findByCategoryId(categoryId, { includeUnavailable })
    : await menuService.findAll({ includeUnavailable });

  res.status(200).json({ success: true, data: menuItems });
});

const addMenuItem = asyncHandler(async (req, res) => {
  const menuItem = await menuService.create(req.body);

  emitRealtimeEvent("menu:changed", {
    action: "menu-item-created",
    menuItemId: menuItem.id,
  });
  res.status(201).json({ success: true, message: "Menu item added!", data: menuItem });
});

const updateMenuItem = asyncHandler(async (req, res, next) => {
  const menuItem = await menuService.update(req.params.id, req.body);

  if (!menuItem) {
    return next(createHttpError(404, "Menu item not found!"));
  }

  emitRealtimeEvent("menu:changed", {
    action: "menu-item-updated",
    menuItemId: menuItem.id,
  });
  res.status(200).json({ success: true, message: "Menu item updated!", data: menuItem });
});

const deleteMenuItem = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const deleted = await menuService.remove(id);

  if (!deleted) {
    return next(createHttpError(404, "Menu item not found!"));
  }

  emitRealtimeEvent("menu:changed", {
    action: "menu-item-deleted",
    menuItemId: Number(id),
  });
  res.status(200).json({ success: true, message: "Menu item deleted!" });
});

const uploadMenuImage = asyncHandler(async (req, res, next) => {
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
});

module.exports = {
  addMenuItem,
  deleteMenuItem,
  getMenuItems,
  updateMenuItem,
  uploadMenuImage,
};
