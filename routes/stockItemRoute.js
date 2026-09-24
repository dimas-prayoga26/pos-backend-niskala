const express = require("express");
const {
  addStockItem,
  deleteStockItem,
  getStockItems,
  updateStockCogs,
  updateStockItem,
  updateStockQuantity,
} = require("../controllers/stockItemController");
const { isVerifiedUser } = require("../middlewares/tokenVerification");

const router = express.Router();

router.route("/").get(isVerifiedUser, getStockItems);
router.route("/").post(isVerifiedUser, addStockItem);
router.route("/:id").put(isVerifiedUser, updateStockItem);
router.route("/:id").delete(isVerifiedUser, deleteStockItem);
router.route("/:id/cogs").patch(isVerifiedUser, updateStockCogs);
router.route("/:id/stock").patch(isVerifiedUser, updateStockQuantity);

module.exports = router;
