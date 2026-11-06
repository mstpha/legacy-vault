require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const logger = require("./config/logger");
const { initSentry } = require("./config/sentry");
const { notFoundHandler, errorHandler } = require("./middleware/errorHandler");
const authRoutes = require("./routes/auth.routes");
const capsuleRoutes = require("./routes/capsule.routes");
const permissionsRoutes = require("./routes/permissions.routes");
const notificationRoutes = require("./routes/notification.routes");
const auditRoutes = require("./routes/audit.routes");
const keysRoutes = require("./routes/keys.routes");
const healthRoutes = require("./routes/health.routes");
const { idempotency } = require("./middleware/idempotency");
const dbRouter = require("./ha/dbRouter");

const app = express();
const { requestHandler: sentryRequestHandler, errorHandler: sentryErrorHandler } = initSentry(app);

// Behind a reverse proxy / PaaS (Render, Railway, Fly, nginx...) req.ip is the proxy's address unless
// this is set, which makes every user share ONE rate-limit bucket. Set TRUST_PROXY=1 in production.
if (process.env.TRUST_PROXY) {
  const v = process.env.TRUST_PROXY;
  app.set("trust proxy", /^\d+$/.test(v) ? Number(v) : v === "true" ? true : v);
}

app.use(sentryRequestHandler);
app.use(helmet());
app.use(cors(require("./config/cors")));
// Capsule routes carry encrypted file uploads (base64 JSON), so they get a bigger body limit.
// This must come BEFORE the global parser, because the first parser to run wins.
app.use("/api/capsules", express.json({ limit: "10mb" }));
app.use(express.json({ limit: "100kb" }));
// HA: pin each API request to the project (A or B) active when it started, and refuse writes with
// 503 + Retry-After during the final drain. Must come after the body parsers (AsyncLocalStorage).
app.use("/api", dbRouter.pinRequest);
app.use("/api", idempotency);

// Structured request logging (method, path, status, duration) for every call.
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    logger.info("http_request", {
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs: Date.now() - start,
    });
  });
  next();
});

// Supervision endpoints (uptime monitors, load balancers):
//   GET /health        HA routing probe - DB router state (A_ACTIVE / B_ACTIVE / DRAINING), outbox size
//   GET /health/live   liveness  - process is up (no dependencies, always cheap)
//   GET /health/ready  readiness - active database, Redis and the inactivity sweep
app.use("/health", healthRoutes);

app.use("/api/auth", authRoutes);
app.use("/api/capsules", capsuleRoutes);
app.use("/api/permissions", permissionsRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/audit", auditRoutes);
app.use("/api/keys", keysRoutes);

app.use(notFoundHandler);
app.use(sentryErrorHandler);
app.use(errorHandler);

module.exports = app;
