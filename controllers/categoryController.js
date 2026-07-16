const createHttpError = require("http-errors");
const Category = require("../models/categoryModel");

const addCategory = async (req, res, next) => {
  try {
    const { name, icon } = req.body;

    if (!name) {
      return next(createHttpError(400, "Category name is required!"));
    }

    const category = await Category.create({ name, icon });
    res
      .status(201)
      .json({ success: true, message: "Category added!", data: category });
  } catch (error) {
    next(error);
  }
};

const getCategories = async (req, res, next) => {
  try {
    const categories = await Category.findAll();
    res.status(200).json({ success: true, data: categories });
  } catch (error) {
    next(error);
  }
};

const updateCategory = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, icon, isActive = true } = req.body;

    if (!Number(id)) {
      return next(createHttpError(404, "Invalid id!"));
    }

    if (!name) {
      return next(createHttpError(400, "Category name is required!"));
    }

    const category = await Category.update(id, {
      name,
      icon,
      isActive,
    });

    if (!category) {
      return next(createHttpError(404, "Category not found!"));
    }

    res
      .status(200)
      .json({ success: true, message: "Category updated!", data: category });
  } catch (error) {
    next(error);
  }
};

const deleteCategory = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!Number(id)) {
      return next(createHttpError(404, "Invalid id!"));
    }

    const deleted = await Category.remove(id);

    if (!deleted) {
      return next(createHttpError(404, "Category not found!"));
    }

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
