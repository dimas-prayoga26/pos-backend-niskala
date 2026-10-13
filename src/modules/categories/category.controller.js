const createHttpError = require("http-errors");
const { emitRealtimeEvent } = require("../../infrastructure/realtime/socket");
const asyncHandler = require("../../shared/http/asyncHandler");
const { isAdmin } = require("../../shared/middleware/authorize");
const Category = require("./category.repository");

// Returns null for "no tax", undefined for an invalid value.
const parseCategoryTax = (value) => {
  if (value === undefined || value === null || value === "") return null;

  const taxRate = Number(value);

  if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) {
    return undefined;
  }

  return taxRate;
};

const parseCategoryStatus = (value) => {
  if (value === undefined || value === null || value === "") return true;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;

  const normalizedValue = String(value).toLowerCase();

  if (["true", "1", "active", "aktif"].includes(normalizedValue)) return true;
  if (["false", "0", "inactive", "nonaktif"].includes(normalizedValue)) {
    return false;
  }

  return Boolean(value);
};

const validateCategoryBody = ({ name }, taxRate) => {
  if (!name) return createHttpError(400, "Category name is required!");
  if (taxRate === undefined) {
    return createHttpError(400, "Category tax must be between 0 and 100.");
  }

  return null;
};

const getCategories = asyncHandler(async (req, res) => {
  const includeInactive = req.query.includeInactive === "true" && isAdmin(req);
  const categories = await Category.findAll({ includeInactive });

  res.status(200).json({ success: true, data: categories });
});

const addCategory = asyncHandler(async (req, res, next) => {
  const { name, icon } = req.body;
  const taxRate = parseCategoryTax(req.body.taxRate ?? req.body.tax);
  const validationError = validateCategoryBody(req.body, taxRate);

  if (validationError) return next(validationError);

  const category = await Category.create({ name, icon, taxRate });
  emitRealtimeEvent("menu:changed", {
    action: "category-created",
    categoryId: category.id,
  });
  res.status(201).json({ success: true, message: "Category added!", data: category });
});

const updateCategory = asyncHandler(async (req, res, next) => {
  const { name, icon } = req.body;
  const isActive = Object.prototype.hasOwnProperty.call(req.body, "isActive")
    ? parseCategoryStatus(req.body.isActive)
    : undefined;
  const taxRate = parseCategoryTax(req.body.taxRate ?? req.body.tax);
  const validationError = validateCategoryBody(req.body, taxRate);

  if (validationError) return next(validationError);

  const category = await Category.update(req.params.id, { name, icon, taxRate, isActive });

  if (!category) {
    return next(createHttpError(404, "Category not found!"));
  }

  emitRealtimeEvent("menu:changed", {
    action: "category-updated",
    categoryId: category.id,
  });
  res.status(200).json({ success: true, message: "Category updated!", data: category });
});

const updateCategoryPositions = asyncHandler(async (req, res, next) => {
  const categoryIds = Array.isArray(req.body.categoryIds)
    ? req.body.categoryIds.map(Number).filter(Boolean)
    : [];

  if (!categoryIds.length) {
    return next(createHttpError(400, "Category positions are required!"));
  }

  const categories = await Category.updatePositions(categoryIds);

  emitRealtimeEvent("menu:changed", { action: "category-positions-updated" });
  res.status(200).json({
    success: true,
    message: "Category positions updated!",
    data: categories,
  });
});

const deleteCategory = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const deleted = await Category.remove(id);

  if (!deleted) {
    return next(createHttpError(404, "Category not found!"));
  }

  emitRealtimeEvent("menu:changed", {
    action: "category-deleted",
    categoryId: Number(id),
  });
  res.status(200).json({ success: true, message: "Category deleted!" });
});

module.exports = {
  addCategory,
  deleteCategory,
  getCategories,
  updateCategory,
  updateCategoryPositions,
};
