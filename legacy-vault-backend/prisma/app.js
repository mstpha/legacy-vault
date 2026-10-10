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

const app = express();
const { requestHandler: sentryRequestHandler, errorHandler: sentryErrorHandler } = initSentry(app);

app.use(sentryRequestHandler);
app.use(helmet());
app.use(cors());
// Capsule routes carry encrypted file uploads (base64 JSON), so they get a bigger body limit.
// This must come BEFORE the global parser, because the first parser to run wins.
app.use("/api/capsules", express.json({ limit: "10mb" }));
app.use(express.json({ limit: "100kb" }));

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

// Supervision endpoint (uptime checks / local dev).
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", uptime: process.uptime() });
});

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
