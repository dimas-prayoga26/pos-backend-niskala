const express = require("express");
const authenticate = require("../../shared/middleware/authenticate");
const { requireRole } = require("../../shared/middleware/authorize");
const { requireNumericId } = require("../../shared/middleware/validateParams");
const {
  addDailyCash,
  addRecap,
  getRecapMeta,
  getRecaps,
} = require("./recap.controller");

const router = express.Router();
const adminOnly = requireRole("admin", "Hanya admin yang bisa menambahkan kas.");
const validDailyRecapId = requireNumericId({ status: 400, message: "Rekap harian tidak valid." });

router.get("/meta", authenticate, getRecapMeta);
router.patch("/daily/:id/cash", authenticate, adminOnly, validDailyRecapId, addDailyCash);
router.get("/:periodType", authenticate, getRecaps);
router.post("/:periodType", authenticate, addRecap);

module.exports = router;
