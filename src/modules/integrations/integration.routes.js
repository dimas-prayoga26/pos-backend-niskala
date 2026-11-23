const express = require("express");
const authenticate = require("../../shared/middleware/authenticate");
const { requireRole } = require("../../shared/middleware/authorize");
const { getStatus, listIntegrations, testIntegration, updateIntegration } = require("./integration.controller");

const router = express.Router();
const adminOnly = requireRole("admin", "Hanya admin yang bisa mengatur API.");

router.use(authenticate);
router.get("/status", getStatus);
// Pengaturan → API (admins): the keys themselves never leave the server.
router.get("/", adminOnly, listIntegrations);
router.put("/:code", adminOnly, updateIntegration);
router.post("/:code/test", adminOnly, testIntegration);

module.exports = router;
