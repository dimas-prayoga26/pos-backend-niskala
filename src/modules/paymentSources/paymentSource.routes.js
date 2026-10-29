const express = require("express");
const authenticate = require("../../shared/middleware/authenticate");
const { requireRole } = require("../../shared/middleware/authorize");
const { requireNumericId } = require("../../shared/middleware/validateParams");
const {
  addPaymentSource,
  addPaymentSourceMutation,
  getPaymentSourceMutations,
  getPaymentSources,
  updatePaymentSource,
} = require("./paymentSource.controller");

const router = express.Router();
// Balances are finance data: only admins manage sources and see saldo. Kasir
// read the active sources (without saldo) to fill in a draft nota.
const adminOnly = requireRole("admin", "Hanya admin yang bisa mengelola sumber pembayaran.");
const staffOnly = requireRole(["admin", "cashier"], "Hanya admin atau kasir yang bisa melihat sumber pembayaran.");

router.use(authenticate);
router.get("/", staffOnly, getPaymentSources);
router.post("/", adminOnly, addPaymentSource);
router.put("/:id", adminOnly, requireNumericId(), updatePaymentSource);
router.get("/:id/mutations", adminOnly, requireNumericId(), getPaymentSourceMutations);
router.post("/:id/mutations", adminOnly, requireNumericId(), addPaymentSourceMutation);

module.exports = router;
