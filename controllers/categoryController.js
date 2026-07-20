const createHttpError = require("http-errors");
const Category = require("../models/categoryModel");
const { emitRealtimeEvent } = require("../config/socket");

const requireAdmin = (req, next) => {
  if (req.user?.role?.toLowerCase() !== "admin") {
    return createHttpError(403, "Only admin can manage categories!");
  }

  return null;
};

const parseCategoryTax = (value) => {
  if (value === undefined || value === null || value === "") return null;

  const taxRate = Number(value);

  if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) {
    return undefined;
  }

  return taxRate;
};

const addCategory = async (req, res, next) => {
  try {
    const permissionError = requireAdmin(req, next);
    if (permissionError) return next(permissionError);

    const { name, icon } = req.body;
    const taxRate = parseCategoryTax(req.body.taxRate ?? req.body.tax);

    if (!name) {
      return next(createHttpError(400, "Category name is required!"));
    }

    if (taxRate === undefined) {
      return next(createHttpError(400, "Category tax must be between 0 and 100."));
    }

    const category = await Category.create({ name, icon, taxRate });
    emitRealtimeEvent("menu:changed", {
      action: "category-created",
      categoryId: category.id || category._id,
    });
    res
      .status(201)
      .json({ success: true, message: "Category added!", data: category });
  } catch (error) {
    next(error);
  }
};

const getCategories = async (req, res, next) => {
  try {
    const includeInactive =
      req.query.includeInactive === "true" &&
      req.user?.role?.toLowerCase() === "admin";
    const categories = await Category.findAll({ includeInactive });
    res.status(200).json({ success: true, data: categories });
  } catch (error) {
    next(error);
  }
};

const updateCategory = async (req, res, next) => {
  try {
    const permissionError = requireAdmin(req, next);
    if (permissionError) return next(permissionError);

    const { id } = req.params;
    const { name, icon, isActive = true } = req.body;
    const taxRate = parseCategoryTax(req.body.taxRate ?? req.body.tax);

    if (!Number(id)) {
      return next(createHttpError(404, "Invalid id!"));
    }

    if (!name) {
      return next(createHttpError(400, "Category name is required!"));
    }

    if (taxRate === undefined) {
      return next(createHttpError(400, "Category tax must be between 0 and 100."));
    }

    const category = await Category.update(id, {
      name,
      icon,
      taxRate,
      isActive,
    });

    if (!category) {
      return next(createHttpError(404, "Category not found!"));
    }

    emitRealtimeEvent("menu:changed", {
      action: "category-updated",
      categoryId: category.id || category._id,
    });
    res
      .status(200)
      .json({ success: true, message: "Category updated!", data: category });
  } catch (error) {
    next(error);
  }
};

const deleteCategory = async (req, res, next) => {
  try {
    const permissionError = requireAdmin(req, next);
    if (permissionError) return next(permissionError);

    const { id } = req.params;

    if (!Number(id)) {
      return next(createHttpError(404, "Invalid id!"));
    }

    const deleted = await Category.remove(id);

    if (!deleted) {
      return next(createHttpError(404, "Category not found!"));
    }

    emitRealtimeEvent("menu:changed", {
      action: "category-deleted",
      categoryId: Number(id),
    });
    res.status(200).json({ success: true, message: "Category deleted!" });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  addCategory,
  deleteCategory,
  getCategories,
  updateCategory,
};
