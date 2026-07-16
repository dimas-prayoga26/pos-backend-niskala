const createHttpError = require("http-errors");
const AddOn = require("../models/addOnModel");

const addAddOn = async (req, res, next) => {
  try {
    const { code, name, price, isActive } = req.body;

    if (!name) {
      return next(createHttpError(400, "Add-on name is required!"));
    }

    const addOn = await AddOn.create({
      code,
      name,
      price,
      isActive,
    });
    res
      .status(201)
      .json({ success: true, message: "Add-on added!", data: addOn });
  } catch (error) {
    next(error);
  }
};

const getAddOns = async (req, res, next) => {
  try {
    const addOns = await AddOn.findAll();

    res.status(200).json({ success: true, data: addOns });
  } catch (error) {
    next(error);
  }
};

const updateAddOn = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { code, name, price, isActive = true } = req.body;

    if (!Number(id)) {
      return next(createHttpError(404, "Invalid id!"));
    }

    if (!name) {
      return next(createHttpError(400, "Add-on name is required!"));
    }

    const addOn = await AddOn.update(id, {
      code,
      name,
      price,
      isActive,
    });

    if (!addOn) {
      return next(createHttpError(404, "Add-on not found!"));
    }

    res
      .status(200)
      .json({ success: true, message: "Add-on updated!", data: addOn });
  } catch (error) {
    next(error);
  }
};

const deleteAddOn = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!Number(id)) {
      return next(createHttpError(404, "Invalid id!"));
    }

    const deleted = await AddOn.remove(id);

    if (!deleted) {
      return next(createHttpError(404, "Add-on not found!"));
    }

    res.status(200).json({ success: true, message: "Add-on deleted!" });
  } catch (error) {
    next(error);
  }
};

module.exports = { addAddOn, deleteAddOn, getAddOns, updateAddOn };
