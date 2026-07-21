const express = require("express");
const { register, login, getUserData, getUsers, logout } = require("../controllers/userController");
const { isVerifiedUser } = require("../middlewares/tokenVerification");
const router = express.Router();


// Authentication Routes
router.route("/register").post(register);
router.route("/login").post(login);
router.route("/logout").post(isVerifiedUser, logout)
router.route("/all").get(isVerifiedUser, getUsers);

router.route("/").get(isVerifiedUser , getUserData);

module.exports = router;
