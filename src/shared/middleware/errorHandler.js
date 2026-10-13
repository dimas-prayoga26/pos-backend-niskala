const config = require("../../config/env");
const logger = require("../logger");

// Error response contract: { status, message, errorStack, details? }.
// Stack traces are only returned in development.
// Express recognizes error handlers by their four parameters.
const errorHandler = (err, req, res, _next) => {
  const statusCode = err.statusCode || 500;

  if (statusCode >= 500) {
    logger.error("Request failed", {
      method: req.method,
      path: req.originalUrl,
      statusCode,
      error: err.message,
      stack: err.stack,
    });
  }

  const response = {
    status: statusCode,
    message: err.message,
    errorStack: config.nodeEnv === "development" ? err.stack : "",
  };

  if (err.details) {
    response.details = err.details;
  }

  return res.status(statusCode).json(response);
};

module.exports = errorHandler;
