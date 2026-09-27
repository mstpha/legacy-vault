const Sentry = require("@sentry/node");
const logger = require("./logger");

function initSentry(app) {
  if (!process.env.SENTRY_DSN) {
    logger.warn("SENTRY_DSN not set — error tracking disabled (fine for local dev).");
    return { requestHandler: (req, res, next) => next(), errorHandler: (err, req, res, next) => next(err) };
  }

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || "development",
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.2 : 1.0,
  });

  return {
    requestHandler: Sentry.Handlers.requestHandler(),
    errorHandler: Sentry.Handlers.errorHandler(),
  };
}

module.exports = { initSentry, Sentry };
