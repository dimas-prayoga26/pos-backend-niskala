const config = require("../config/config");

const globalErrorHandler = (err, req, res, next) => {
    const statusCode = err.statusCode || 500;

    const response = {
        status: statusCode,
        message: err.message,
        errorStack: config.nodeEnv === "development" ? err.stack : ""
    };

    if (err.details) {
        response.details = err.details;
    }

    return res.status(statusCode).json(response)
}

module.exports = globalErrorHandler;
