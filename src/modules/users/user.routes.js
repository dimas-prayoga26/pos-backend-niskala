const express = require("express");
const authenticate = require("../../shared/middleware/authenticate");
const { requireRole } = require("../../shared/middleware/authorize");
const { getUserData, getUsers, login, logout, register } = require("./user.controller");

const router = express.Router();

router.post("/register", register);
router.post("/login", login);
router.post("/logout", authenticate, logout);
router.get("/all", authenticate, requireRole("admin", "Only admin can view users!"), getUsers);
router.get("/", authenticate, getUserData);

module.exports = router;
