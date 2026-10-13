const createHttpError = require("http-errors");

// Rejects ids that are not a non-zero number before the handler runs.
const requireNumericId = ({
  param = "id",
  status = 404,
  message = "Invalid id!",
} = {}) => (req, _res, next) => {
  if (!Number(req.params[param])) {
    return next(createHttpError(status, message));
  }

  return next();
};

module.exports = { requireNumericId };
