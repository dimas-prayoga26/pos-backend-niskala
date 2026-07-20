const express = require("express");
const {
  addOrderPlatform,
  deleteOrderPlatform,
  getOrderPlatforms,
  updateOrderPlatform,
} = require("../controllers/orderPlatformController");
const { isVerifiedUser } = require("../middlewares/tokenVerification");

const router = express.Router();

router.route("/").get(isVerifiedUser, getOrderPlatforms);
router.route("/").post(isVerifiedUser, addOrderPlatform);
router.route("/:id").put(isVerifiedUser, updateOrderPlatform);
router.route("/:id").delete(isVerifiedUser, deleteOrderPlatform);

module.exports = router;
