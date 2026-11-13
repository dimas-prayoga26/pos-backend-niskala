const express = require("express");
const config = require("../../config/env");
const authenticate = require("../../shared/middleware/authenticate");
const { requireRole } = require("../../shared/middleware/authorize");
const { clientIpOf, createRateLimit } = require("../../shared/middleware/rateLimit");
const { getUserData, getUsers, login, logout, register } = require("./user.controller");

const router = express.Router();

// Guessing passwords: after N wrong ones for an account from a device, its
// logins wait 15 minutes. A right password does not count.
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const loginLimit =
  config.rateLimit.loginFailures > 0
    ? createRateLimit({
        windowMs: LOGIN_WINDOW_MS,
        max: config.rateLimit.loginFailures,
        countFailuresOnly: true,
        keyOf: (req) =>
          `login:${String(req.body?.email || "").trim().toLowerCase()}|${clientIpOf(req)}`,
        message: (seconds) =>
          `Terlalu banyak percobaan login gagal. Coba lagi dalam ${Math.ceil(seconds / 60)} menit.`,
      })
    : (req, res, next) => next();

router.post("/register", register);
router.post("/login", loginLimit, login);
router.post("/logout", authenticate, logout);
router.get("/all", authenticate, requireRole("admin", "Only admin can view users!"), getUsers);
router.get("/", authenticate, getUserData);

module.exports = router;
