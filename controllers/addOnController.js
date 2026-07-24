const createHttpError = require("http-errors");
const AddOn = require("../models/addOnModel");
const { emitRealtimeEvent } = require("../config/socket");

const addAddOn = async (req, res, next) => {
  try {
    const { code, name, price, imagePath, isActive } = req.body;

    if (!name) {
      return next(createHttpError(400, "Add-on name is required!"));
    }

    const addOn = await AddOn.create({
      code,
      name,
      price,
      imagePath,
      isActive,
    });
    emitRealtimeEvent("menu:changed", {
      action: "add-on-created",
      addOnId: addOn.id || addOn._id,
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
    const { code, name, price, imagePath, isActive = true } = req.body;

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
      imagePath,
      isActive,
    });

    if (!addOn) {
      return next(createHttpError(404, "Add-on not found!"));
    }

    emitRealtimeEvent("menu:changed", {
      action: "add-on-updated",
      addOnId: addOn.id || addOn._id,
    });
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

    emitRealtimeEvent("menu:changed", {
      action: "add-on-deleted",
      addOnId: Number(id),
    });
    res.status(200).json({ success: true, message: "Add-on deleted!" });
  } catch (error) {
    next(error);
  }
};

module.exports = { addAddOn, deleteAddOn, getAddOns, updateAddOn };
