const express = require("express");
const {
  addAddOn,
  deleteAddOn,
  getAddOns,
  updateAddOn,
} = require("../controllers/addOnController");
const { isVerifiedUser } = require("../middlewares/tokenVerification");

const router = express.Router();

router.route("/").get(isVerifiedUser, getAddOns);
router.route("/").post(isVerifiedUser, addAddOn);
router.route("/:id").put(isVerifiedUser, updateAddOn);
router.route("/:id").delete(isVerifiedUser, deleteAddOn);

module.exports = router;
