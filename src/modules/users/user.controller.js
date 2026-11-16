const config = require("../../config/env");
const asyncHandler = require("../../shared/http/asyncHandler");
const userService = require("./user.service");

const authCookieOptions = {
  maxAge: 1000 * 60 * 60 * 24 * 30,
  httpOnly: true,
  sameSite: config.nodeEnv === "production" ? "none" : "lax",
  secure: config.nodeEnv === "production",
};

// req.user: the logged-in requester, if any (see optionalAuthenticate).
const register = asyncHandler(async (req, res) => {
  const newUser = await userService.register(req.body, req.user);

  res.status(201).json({ success: true, message: "New user created!", data: newUser });
});

const updateUser = asyncHandler(async (req, res) => {
  const user = await userService.update(req.params.id, req.body || {});

  res.status(200).json({ success: true, message: "Akun berhasil diubah.", data: user });
});

const deleteUser = asyncHandler(async (req, res) => {
  await userService.remove(req.params.id, req.user);

  res.status(200).json({ success: true, message: "Akun berhasil dihapus." });
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

module.exports = { deleteUser, getUserData, getUsers, login, logout, register, updateUser };
