const express = require("express");
const { getDb } = require("../config/db");
const dbRouter = require("../ha/dbRouter");
const logger = require("../config/logger");
const { getSweepStatus } = require("../services/monitoring.service");

const router = express.Router();

const CHECK_TIMEOUT_MS = Number(process.env.HEALTH_CHECK_TIMEOUT_MS || 2000);
const SWEEP_INTERVAL_MS = Number(process.env.INACTIVITY_SWEEP_INTERVAL_MS || 15 * 60 * 1000);
const VERSION = process.env.APP_VERSION || require("../../package.json").version;

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Runs one dependency check. Error details go to the logs, never into the public response.
async function check(label, fn) {
  const started = Date.now();
  try {
    await withTimeout(fn(), CHECK_TIMEOUT_MS, label);
    return { status: "up", latencyMs: Date.now() - started };
  } catch (err) {
    logger.error("health_check_failed", { check: label, message: err.message });
    return { status: "down", latencyMs: Date.now() - started };
  }
}

// HA routing probe. Unlike the primary, this does not query anything per call: it reports the DB
// router's state, which the router refreshes every A_CHECK_INTERVAL_MS. 200 while either project can
// serve (the router fails over on its own), 503 only when neither A nor B answers.
const SYNC_WORKER_STATUS_URL = process.env.SYNC_WORKER_STATUS_URL || "";

async function workerStatus() {
  if (!SYNC_WORKER_STATUS_URL) return undefined;
  try {
    const res = await withTimeout(fetch(SYNC_WORKER_STATUS_URL), 500, "sync worker status");
    return res.ok ? await res.json() : { status: "error", httpStatus: res.status };
  } catch (err) {
    return { status: "unreachable" };
  }
}

router.get("/", async (req, res) => {
  const ha = dbRouter.getStatus();
  const status = !ha.canServe ? "unavailable" : ha.activeUp && ha.db.state === "A_ACTIVE" ? "ok" : "degraded";
  res.status(ha.canServe ? 200 : 503).json({
    role: process.env.SERVER_ROLE || "backup",
    status,
    db: ha.db,
    outboxPending: ha.outboxPending,
    sync: await workerStatus(),
    uptime: process.uptime(),
    version: VERSION,
    timestamp: new Date().toISOString(),
  });
});

// Liveness: "is the process answering?". No dependencies, so it stays cheap and never flaps because
// of the database. Good target for a container/PaaS health check and for a 1-minute uptime ping.
router.get("/live", (req, res) => {
  res.status(200).json({
    status: "ok",
    uptime: process.uptime(),
    version: VERSION,
    timestamp: new Date().toISOString(),
  });
});

// Readiness: "can it actually serve?".
//   database down            -> 503 (nothing works)
//   Redis down / sweep stale -> 200 "degraded" (API still serves, but inactivity detection is not
//                               running, which for a legacy vault must page someone: point a keyword
//                               monitor at "status":"ok" so degraded also alerts)
router.get("/ready", async (req, res) => {
  const checks = {};
  checks.database = await check("database", () => getDb().$queryRaw`SELECT 1`);
  checks.redis = await check("redis", async () => {
    // Required lazily: importing it opens a connection, which the unit/e2e tests should not do.
    const redis = require("../config/redis");
    const pong = await redis.ping();
    if (pong !== "PONG") throw new Error(`unexpected reply ${pong}`);
  });

  // The inactivity sweep must have run recently (3 missed intervals = stale). Right after boot
  // there is a grace period before the first run is expected.
  const sweep = getSweepStatus();
  const sinceLastRun = sweep.lastRunAt ? Date.now() - sweep.lastRunAt.getTime() : null;
  let sweepState = "ok";
  if (sweep.lastError && (sinceLastRun === null || sinceLastRun > SWEEP_INTERVAL_MS)) sweepState = "failing";
  else if (sinceLastRun === null) sweepState = process.uptime() * 1000 > 2 * SWEEP_INTERVAL_MS ? "stale" : "pending";
  else if (sinceLastRun > 3 * SWEEP_INTERVAL_MS) sweepState = "stale";
  checks.inactivitySweep = {
    status: sweepState,
    lastRunAt: sweep.lastRunAt ? sweep.lastRunAt.toISOString() : null,
    lastDurationMs: sweep.lastDurationMs,
  };

  let status = "ok";
  let httpStatus = 200;
  if (checks.database.status === "down") {
    status = "unavailable";
    httpStatus = 503;
  } else if (checks.redis.status === "down" || ["stale", "failing"].includes(sweepState)) {
    status = "degraded";
  }

  res.status(httpStatus).json({ status, version: VERSION, timestamp: new Date().toISOString(), checks });
});

module.exports = router;
