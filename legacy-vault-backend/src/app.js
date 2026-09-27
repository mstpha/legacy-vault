require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const logger = require("./config/logger");
const { initSentry } = require("./config/sentry");
const { notFoundHandler, errorHandler } = require("./middleware/errorHandler");
const authRoutes = require("./routes/auth.routes");

const app = express();
const { requestHandler: sentryRequestHandler, errorHandler: sentryErrorHandler } = initSentry(app);

app.use(sentryRequestHandler);
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "1mb" }));

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

// Supervision endpoint (Sprint 6 asks for this too, but wiring it now costs nothing
// and is immediately useful for local dev / uptime checks).
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", uptime: process.uptime() });
});

app.use("/api/auth", authRoutes);

app.use(notFoundHandler);
app.use(sentryErrorHandler);
app.use(errorHandler);

module.exports = app;
