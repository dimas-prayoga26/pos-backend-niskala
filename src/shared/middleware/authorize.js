const createHttpError = require("http-errors");

const getUserRole = (req) => req.user?.role?.toLowerCase();

// Route guard: roles are compared case-insensitively ("Admin" -> "admin").
const requireRole = (roles, message) => {
  const allowedRoles = Array.isArray(roles) ? roles : [roles];

  return (req, _res, next) => {
    if (!allowedRoles.includes(getUserRole(req))) {
      return next(createHttpError(403, message));
    }

    return next();
  };
};

const isAdmin = (req) => getUserRole(req) === "admin";

module.exports = { getUserRole, isAdmin, requireRole };
