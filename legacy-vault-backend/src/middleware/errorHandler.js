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

// HA: "database unreachable" answers 503 (not 500) so the app fails over to the backup server.
// Deliberately no Retry-After: that header means "transient, retry this same server".
const DB_UNAVAILABLE_CODES = new Set(["P1001", "P1002", "P1008", "P1017", "P2024"]);
function isDbUnavailable(err) {
  return err?.name === "PrismaClientInitializationError" || DB_UNAVAILABLE_CODES.has(err?.code);
}

// Last middleware in the chain — mounted after Sentry's error handler
function errorHandler(err, req, res, _next) {
  const dbDown = isDbUnavailable(err);
  const statusCode = dbDown ? 503 : err.statusCode || 500;

  if (dbDown) {
    logger.error("database_unavailable", { message: err.message, path: req.originalUrl });
    return res.status(503).json({ error: { message: "Service temporarily unavailable.", code: "DB_UNAVAILABLE" } });
  }

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
