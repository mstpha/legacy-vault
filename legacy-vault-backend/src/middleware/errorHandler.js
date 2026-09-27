const logger = require("../config/logger");

class ApiError extends Error {
  constructor(statusCode, message, details) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
  }
}

// 404 fallback — mounted after all routes
function notFoundHandler(req, res, next) {
  next(new ApiError(404, `Route not found: ${req.method} ${req.originalUrl}`));
}

// Last middleware in the chain — mounted after Sentry's error handler
function errorHandler(err, req, res, _next) {
  const statusCode = err.statusCode || 500;

  if (statusCode >= 500) {
    logger.error(err.message, { stack: err.stack, path: req.originalUrl });
  } else {
    logger.warn(err.message, { path: req.originalUrl, statusCode });
  }

  res.status(statusCode).json({
    error: {
      message: statusCode >= 500 ? "Internal server error" : err.message,
      details: statusCode < 500 ? err.details : undefined,
      // Sentry attaches an id to the response when it captures a 500
      sentryId: res.sentry,
    },
  });
}

module.exports = { ApiError, notFoundHandler, errorHandler };
