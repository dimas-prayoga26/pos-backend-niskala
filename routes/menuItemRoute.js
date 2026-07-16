const express = require("express");
const {
  addMenuItem,
  deleteMenuItem,
  getMenuItems,
  updateMenuItem,
} = require("../controllers/menuItemController");
const { isVerifiedUser } = require("../middlewares/tokenVerification");

const router = express.Router();

router.route("/").get(isVerifiedUser, getMenuItems);
router.route("/").post(isVerifiedUser, addMenuItem);
router.route("/:id").put(isVerifiedUser, updateMenuItem);
router.route("/:id").delete(isVerifiedUser, deleteMenuItem);

module.exports = router;
