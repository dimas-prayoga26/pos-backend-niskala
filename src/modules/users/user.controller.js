const config = require("../../config/env");
const asyncHandler = require("../../shared/http/asyncHandler");
const userService = require("./user.service");

const authCookieOptions = {
  maxAge: 1000 * 60 * 60 * 24 * 30,
  httpOnly: true,
  sameSite: config.nodeEnv === "production" ? "none" : "lax",
  secure: config.nodeEnv === "production",
};

const register = asyncHandler(async (req, res) => {
  const newUser = await userService.register(req.body);

  res.status(201).json({ success: true, message: "New user created!", data: newUser });
});

const login = asyncHandler(async (req, res) => {
  const { accessToken, user } = await userService.login(req.body);

  res.cookie("accessToken", accessToken, authCookieOptions);
  res.status(200).json({ success: true, message: "User login successfully!", data: user });
});

// req.user is loaded fresh from the database by the authenticate middleware.
const getUserData = asyncHandler(async (req, res) => {
  res.status(200).json({ success: true, data: req.user });
});

const getUsers = asyncHandler(async (req, res) => {
  const users = await userService.findAll();

  res.status(200).json({ success: true, data: users });
});

const logout = asyncHandler(async (req, res) => {
  res.clearCookie("accessToken", authCookieOptions);
  res.status(200).json({ success: true, message: "User logout successfully!" });
});

module.exports = { getUserData, getUsers, login, logout, register };
