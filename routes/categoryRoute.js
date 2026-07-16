const express = require("express");
const {
  addCategory,
  deleteCategory,
  getCategories,
  updateCategory,
} = require("../controllers/categoryController");
const { isVerifiedUser } = require("../middlewares/tokenVerification");

const router = express.Router();

router.route("/").get(isVerifiedUser, getCategories);
router.route("/").post(isVerifiedUser, addCategory);
router.route("/:id").put(isVerifiedUser, updateCategory);
router.route("/:id").delete(isVerifiedUser, deleteCategory);

module.exports = router;
