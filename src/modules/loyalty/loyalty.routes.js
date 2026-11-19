const express = require("express");
const authenticate = require("../../shared/middleware/authenticate");
const { requireRole } = require("../../shared/middleware/authorize");
const { getCustomer, redeemReward } = require("./loyalty.controller");

const router = express.Router();
const staff = ["admin", "cashier"];

router.get("/customers/:phone", authenticate, getCustomer);
router.post(
  "/redemptions",
  authenticate,
  requireRole(staff, "Only admin or cashier can redeem loyalty rewards!"),
  redeemReward
);

module.exports = router;
