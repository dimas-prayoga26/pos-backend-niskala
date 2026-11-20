const express = require("express");
const authenticate = require("../../shared/middleware/authenticate");
const { requireRole } = require("../../shared/middleware/authorize");
const { requireNumericId } = require("../../shared/middleware/validateParams");
const {
  addReward,
  getCustomer,
  getProgram,
  listRedemptions,
  redeemReward,
  updateProgram,
  updateReward,
} = require("./loyalty.controller");

const router = express.Router();
const staff = ["admin", "cashier"];
const adminOnly = requireRole(["admin"], "Hanya admin yang bisa mengatur Program Promo.");

router.get("/customers/:phone", authenticate, getCustomer);
// Program Promo → Riwayat: the rewards handed over.
router.get("/redemptions", authenticate, adminOnly, listRedemptions);
router.post(
  "/redemptions",
  authenticate,
  requireRole(staff, "Only admin or cashier can redeem loyalty rewards!"),
  redeemReward
);

// Program Promo: the stamp card on/off and its rewards.
router.get("/program", authenticate, getProgram);
router.put("/program", authenticate, adminOnly, updateProgram);
router.post("/rewards", authenticate, adminOnly, addReward);
router.put("/rewards/:id", authenticate, adminOnly, requireNumericId(), updateReward);

module.exports = router;
