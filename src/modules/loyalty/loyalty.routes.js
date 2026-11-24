const express = require("express");
const authenticate = require("../../shared/middleware/authenticate");
const { requireRole } = require("../../shared/middleware/authorize");
const { requireNumericId } = require("../../shared/middleware/validateParams");
const {
  addReward,
  getCustomer,
  getProgram,
  getVoucher,
  listMembers,
  listRedemptions,
  listStamps,
  redeemReward,
  updateProgram,
  updateReward,
} = require("./loyalty.controller");

const router = express.Router();
const staff = ["admin", "cashier"];
const adminOnly = requireRole(["admin"], "Hanya admin yang bisa mengatur Program Promo.");

router.get("/customers/:phone", authenticate, getCustomer);
// The QR on the back of a stamp card, scanned at the till.
router.get(
  "/vouchers/:code",
  authenticate,
  requireRole(staff, "Only admin or cashier can scan loyalty vouchers!"),
  getVoucher
);
// Stamp Card → Riwayat: the stamps given, the rewards handed over and the
// members with all their stamps.
router.get("/stamps", authenticate, adminOnly, listStamps);
router.get("/redemptions", authenticate, adminOnly, listRedemptions);
router.get("/members", authenticate, adminOnly, listMembers);
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
