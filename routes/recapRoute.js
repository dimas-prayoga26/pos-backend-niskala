const express = require("express");
const {
  addDailyCash,
  addRecap,
  getRecapMeta,
  getRecaps,
} = require("../controllers/recapController");
const { isVerifiedUser } = require("../middlewares/tokenVerification");

const router = express.Router();

router.route("/meta").get(isVerifiedUser, getRecapMeta);
router.route("/daily/:id/cash").patch(isVerifiedUser, addDailyCash);
router.route("/:periodType").get(isVerifiedUser, getRecaps);
router.route("/:periodType").post(isVerifiedUser, addRecap);

module.exports = router;
