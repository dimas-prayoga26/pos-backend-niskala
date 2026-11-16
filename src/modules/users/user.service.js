const bcrypt = require("bcrypt");
const createHttpError = require("http-errors");
const jwt = require("jsonwebtoken");
const config = require("../../config/env");
const User = require("./user.repository");

const ALLOWED_ROLES = ["admin", "cashier"];
const ACCESS_TOKEN_TTL = "1d";

const toRole = (role) => {
  const normalizedRole = String(role || "").toLowerCase();
  if (!ALLOWED_ROLES.includes(normalizedRole)) {
    throw createHttpError(400, "Role must be Admin or Cashier!");
  }
  return normalizedRole === "admin" ? "Admin" : "Cashier";
};

const isAdminUser = (user) => String(user?.role || "").toLowerCase() === "admin";

// Accounts are made by an admin; only the very first account (setting up
// the POS) needs nobody logged in.
const register = async ({ name, phone, email, password, role }, requester = null) => {
  if (!name || !phone || !email || !password || !role) {
    throw createHttpError(400, "All fields are required!");
  }

  const userRole = toRole(role);

  if (!isAdminUser(requester) && (await User.countAll()) > 0) {
    throw createHttpError(403, "Hanya admin yang bisa membuat akun.");
  }

  if (await User.findByEmail(email)) {
    throw createHttpError(400, "User already exist!");
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  return User.create({ name, phone, email, password: hashedPassword, role: userRole });
};

// An admin changes an account: name, phone, email, role, and the password
// when a new one is given. The last admin stays an admin.
const update = async (id, { name, phone, email, role, password }) => {
  const user = await User.findById(id);
  if (!user) throw createHttpError(404, "Akun tidak ditemukan.");
  if (!String(name || "").trim() || !String(phone || "").trim() || !String(email || "").trim()) {
    throw createHttpError(400, "Nama, nomor HP, dan email wajib diisi.");
  }

  const userRole = toRole(role);
  if (isAdminUser(user) && userRole !== "Admin" && (await User.countAdmins()) <= 1) {
    throw createHttpError(400, "Minimal harus ada 1 admin.");
  }

  const sameEmail = await User.findByEmail(String(email).trim());
  if (sameEmail && Number(sameEmail.id) !== Number(id)) {
    throw createHttpError(400, "Email sudah dipakai akun lain.");
  }

  const fields = {
    name: String(name).trim(),
    phone: String(phone).trim(),
    email: String(email).trim(),
    role: userRole,
  };
  if (String(password || "")) {
    if (String(password).length < 6) throw createHttpError(400, "Password minimal 6 karakter.");
    fields.password = await bcrypt.hash(String(password), 10);
  }

  return User.update(id, fields);
};

// An admin removes another account, never their own, nor the last admin.
const remove = async (id, requester) => {
  if (Number(id) === Number(requester?.id)) {
    throw createHttpError(400, "Tidak bisa menghapus akun sendiri.");
  }
  const user = await User.findById(id);
  if (!user) throw createHttpError(404, "Akun tidak ditemukan.");
  if (isAdminUser(user) && (await User.countAdmins()) <= 1) {
    throw createHttpError(400, "Minimal harus ada 1 admin.");
  }

  return User.remove(id);
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
  remove,
  update,
  verifyAccessToken,
};
