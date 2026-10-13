const bcrypt = require("bcrypt");
const createHttpError = require("http-errors");
const jwt = require("jsonwebtoken");
const config = require("../../config/env");
const User = require("./user.repository");

const ALLOWED_ROLES = ["admin", "cashier"];
const ACCESS_TOKEN_TTL = "1d";

const register = async ({ name, phone, email, password, role }) => {
  if (!name || !phone || !email || !password || !role) {
    throw createHttpError(400, "All fields are required!");
  }

  const normalizedRole = String(role).toLowerCase();

  if (!ALLOWED_ROLES.includes(normalizedRole)) {
    throw createHttpError(400, "Role must be Admin or Cashier!");
  }

  if (await User.findByEmail(email)) {
    throw createHttpError(400, "User already exist!");
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  return User.create({
    name,
    phone,
    email,
    password: hashedPassword,
    role: normalizedRole === "admin" ? "Admin" : "Cashier",
  });
};

// Returns the public user plus a signed access token, or throws 400/401.
const login = async ({ email, password }) => {
  if (!email || !password) {
    throw createHttpError(400, "All fields are required!");
  }

  const user = await User.findByEmailForAuth(email);
  if (!user) {
    throw createHttpError(401, "Invalid Credentials");
  }

  const { password: passwordHash, ...publicUser } = user;
  const isMatch = await bcrypt.compare(password, passwordHash);
  if (!isMatch) {
    throw createHttpError(401, "Invalid Credentials");
  }

  const accessToken = jwt.sign({ _id: user._id }, config.accessTokenSecret, {
    expiresIn: ACCESS_TOKEN_TTL,
  });

  return { accessToken, user: publicUser };
};

const verifyAccessToken = (accessToken) =>
  jwt.verify(accessToken, config.accessTokenSecret);

module.exports = {
  findAll: User.findAll,
  findById: User.findById,
  login,
  register,
  verifyAccessToken,
};
