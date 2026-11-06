// Sync worker: a separate local process (`npm run sync:worker` in the backup folder).
//
// Every SYNC_WORKER_INTERVAL_MS:
//   1. B -> A: if B's outbox has pending rows and A answers, replay them to A (in order, LWW).
//   2. A -> B: only once B's outbox is empty (so B's outage writes reach A BEFORE A's stream resumes),
//      apply A's change log to B. This keeps B a warm standby whatever backend is serving.
// Each direction backs off exponentially while a project is unreachable, and the process never exits
// on a DB error. Progress is persisted in the change_log rows themselves (status column), so a restart
// resumes exactly where it stopped.
//
// Status: GET http://127.0.0.1:${SYNC_WORKER_STATUS_PORT}/status (read by the backup's /health).
require("dotenv").config();
const http = require("http");
const logger = require("../config/logger");
const { createNodes, disconnectNodes, withTimeout } = require("./clients");
const { pendingCount, drain, housekeeping } = require("./syncEngine");
const { runSyncCheck } = require("./syncCheck");

const INTERVAL_MS = Number(process.env.SYNC_WORKER_INTERVAL_MS || 1000);
const BATCH_SIZE = Number(process.env.SYNC_BATCH_SIZE || 200);
const MAX_BACKOFF_MS = Number(process.env.SYNC_MAX_BACKOFF_MS || 30000);
const STATUS_PORT = Number(process.env.SYNC_WORKER_STATUS_PORT || 4100);
const CHECK_TIMEOUT_MS = Number(process.env.A_CHECK_TIMEOUT_MS || 1500);
const HOUSEKEEPING_EVERY_MS = 60 * 60 * 1000;
const SYNC_CHECK_INTERVAL_MS = Number(process.env.SYNC_CHECK_INTERVAL_MS ?? 60 * 60 * 1000); // 0 disables

const nodes = createNodes();
const newDirection = () => ({ pending: null, lastRunAt: null, lastSuccessAt: null, lastError: null, applied: 0, skipped: 0, conflicts: 0, backoffMs: 0, nextAttemptAt: 0 });
const status = {
  startedAt: new Date().toISOString(),
  aToB: newDirection(),
  bToA: newDirection(),
  lastHousekeepingAt: null,
  lastSyncCheck: null,
};

let stopping = false;
let lastHousekeeping = 0;
let lastSyncCheck = Date.now(); // first scheduled run one interval after start

function fail(dir, err) {
  dir.lastError = err.message;
  dir.backoffMs = Math.min(dir.backoffMs ? dir.backoffMs * 2 : 1000, MAX_BACKOFF_MS);
  dir.nextAttemptAt = Date.now() + dir.backoffMs + Math.floor(Math.random() * 250);
}

function succeed(dir, stats) {
  dir.lastSuccessAt = new Date().toISOString();
  dir.lastError = null;
  dir.backoffMs = 0;
  dir.nextAttemptAt = 0;
  if (stats) {
    dir.applied += stats.applied;
    dir.skipped += stats.skipped;
    dir.conflicts += stats.conflicts;
  }
}

async function runDirection(dir, source, target, { allowed }) {
  if (Date.now() < dir.nextAttemptAt) return;
  dir.lastRunAt = new Date().toISOString();
  try {
    dir.pending = await withTimeout(pendingCount(source), CHECK_TIMEOUT_MS, `${source.name} pending count`);
    if (dir.pending > 0 && allowed()) {
      const stats = await drain(source, target, { batchSize: BATCH_SIZE, maxBatches: 50 });
      if (stats.applied || stats.conflicts) logger.info("sync_applied", { from: source.name, to: target.name, ...stats });
      dir.pending = await pendingCount(source);
      succeed(dir, stats);
    } else {
      succeed(dir);
    }
  } catch (err) {
    if (!dir.lastError) logger.warn("sync_direction_failed", { from: source.name, to: target.name, message: err.message });
    fail(dir, err);
  }
}

async function loop() {
  const { A, B } = nodes;
  if (!A.configured || !B.configured) {
    logger.error("sync_worker_needs_both_projects", { a: A.configured, b: B.configured });
    process.exit(1);
  }

  while (!stopping) {
    await runDirection(status.bToA, B, A, { allowed: () => true });
    // A -> B waits until B has nothing left to send (or B can't be read: then A -> B can't run either).
    await runDirection(status.aToB, A, B, { allowed: () => status.bToA.pending === 0 });

    if (Date.now() - lastHousekeeping > HOUSEKEEPING_EVERY_MS) {
      lastHousekeeping = Date.now();
      for (const node of [A, B]) {
        try {
          const r = await housekeeping(node);
          logger.info("sync_housekeeping", { node: node.name, ...r });
        } catch (err) {
          logger.warn("sync_housekeeping_failed", { node: node.name, message: err.message });
        }
      }
      status.lastHousekeepingAt = new Date().toISOString();
    }

    if (SYNC_CHECK_INTERVAL_MS > 0 && Date.now() - lastSyncCheck > SYNC_CHECK_INTERVAL_MS) {
      lastSyncCheck = Date.now();
      try {
        const report = await runSyncCheck({ nodes, fix: true, trigger: "schedule" });
        status.lastSyncCheck = { at: new Date().toISOString(), clean: report.clean, fixed: report.totals.fixed, skipped: report.skipped };
      } catch (err) {
        status.lastSyncCheck = { at: new Date().toISOString(), error: err.message };
      }
    }

    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
}

const statusServer = http.createServer((req, res) => {
  if (req.method === "GET" && (req.url === "/status" || req.url === "/")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(status));
  }
  res.writeHead(404).end();
});
// The status port doubles as a single-instance lock: a second worker exits instead of crashing.
statusServer.on("error", async (err) => {
  if (err.code !== "EADDRINUSE") throw err;
  logger.warn(`Port ${STATUS_PORT} is in use: another sync worker is already running. Exiting.`);
  stopping = true;
  await disconnectNodes(nodes);
  process.exit(0);
});
statusServer.listen(STATUS_PORT, "127.0.0.1", () => logger.info(`Sync worker status on http://127.0.0.1:${STATUS_PORT}/status`));

async function shutdown(signal) {
  logger.info(`${signal} received, stopping sync worker...`);
  stopping = true;
  statusServer.close();
  await disconnectNodes(nodes);
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("unhandledRejection", (reason) => logger.error("sync_worker_unhandled_rejection", { reason: reason?.message || reason }));

logger.info("sync_worker_started", { intervalMs: INTERVAL_MS, batchSize: BATCH_SIZE, syncCheckIntervalMs: SYNC_CHECK_INTERVAL_MS });
loop();
