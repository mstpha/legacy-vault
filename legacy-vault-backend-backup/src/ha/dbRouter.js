const { AsyncLocalStorage } = require("async_hooks");
const logger = require("../config/logger");
const { createNodes, disconnectNodes, isConnectionError, withTimeout } = require("./clients");

// DB router of the BACKUP backend.
//
//   A_ACTIVE  A healthy: every read/write goes to A. B is only a warm standby (fed by the sync worker).
//   B_ACTIVE  A unreachable: reads/writes go to B, B's triggers journal every write into its outbox.
//   DRAINING  A is back: the outbox is replayed to A while B keeps serving. Final step pauses writes
//             (503 + Retry-After, reads still served), drains to zero, then flips to A_ACTIVE.
//
// Hysteresis: A -> B after A_FAIL_THRESHOLD consecutive failed checks; B -> A only after
// A_RECOVER_THRESHOLD consecutive successes AND a completed drain.
//
// Every request is pinned to the node that was active when it started (AsyncLocalStorage), so a
// request never reads from one project and writes to the other halfway through a transition.

const cfg = {
  failThreshold: Number(process.env.A_FAIL_THRESHOLD || 3),
  recoverThreshold: Number(process.env.A_RECOVER_THRESHOLD || 5),
  checkIntervalMs: Number(process.env.A_CHECK_INTERVAL_MS || 2000),
  checkTimeoutMs: Number(process.env.A_CHECK_TIMEOUT_MS || 1500),
  // B's own health uses the same counters/threshold, used for the "B lost while A is back" escape hatch.
  bFailThreshold: Number(process.env.B_FAIL_THRESHOLD || process.env.A_FAIL_THRESHOLD || 3),
  finalDrainThreshold: Number(process.env.FINAL_DRAIN_THRESHOLD || 50),
  finalDrainTimeoutMs: Number(process.env.FINAL_DRAIN_TIMEOUT_MS || 15000),
  writePauseRetryAfterS: Number(process.env.WRITE_PAUSE_RETRY_AFTER_S || 2),
  drainBatchSize: Number(process.env.DRAIN_BATCH_SIZE || 200),
};

const STATES = { A_ACTIVE: "A_ACTIVE", B_ACTIVE: "B_ACTIVE", DRAINING: "DRAINING" };
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const als = new AsyncLocalStorage();
let nodes = null;

const newHealth = () => ({
  status: "unknown",
  consecutiveFailures: 0,
  consecutiveSuccesses: 0,
  lastCheckedAt: null,
  latencyMs: null,
});

const state = {
  mode: STATES.A_ACTIVE,
  active: "A",
  writesPaused: false,
  a: newHealth(),
  b: newHealth(),
  outboxPending: null,
  lastTransition: null,
  transitions: [], // last 20, for /health and debugging
};

const inflight = { A: { total: 0, writes: 0 }, B: { total: 0, writes: 0 } };
let timer = null;
let ticking = false;
let draining = null; // promise of the running drain/cutover, if any
const listeners = new Set();

function ensureNodes() {
  if (!nodes) nodes = createNodes();
  return nodes;
}

// ---- Data-access provider (the ONLY way app code reaches a database) ---------------------------

function currentNodeName() {
  return als.getStore()?.node || state.active;
}

function getDb() {
  const node = ensureNodes()[currentNodeName()];
  if (!node.db) throw Object.assign(new Error(`Database ${node.name} is not configured`), { code: "P1001" });
  return node.db;
}

function getStorage() {
  const node = ensureNodes()[currentNodeName()];
  if (!node.supabase) throw new Error(`Supabase Storage for ${node.name} is not configured`);
  return node.supabase;
}

function getNodes() {
  return ensureNodes();
}

// ---- Express middleware -------------------------------------------------------------------------

// Mount AFTER the body parsers: AsyncLocalStorage context does not survive the stream callbacks
// they finish in.
function pinRequest(req, res, next) {
  const node = state.active;
  const isWrite = WRITE_METHODS.has(req.method);

  if (isWrite && state.writesPaused) {
    res.set("Retry-After", String(cfg.writePauseRetryAfterS));
    return res.status(503).json({
      error: { message: "Writes are briefly paused while the database fails back. Please retry.", code: "WRITE_PAUSED" },
    });
  }

  inflight[node].total += 1;
  if (isWrite) inflight[node].writes += 1;
  let done = false;
  const release = () => {
    if (done) return;
    done = true;
    inflight[node].total -= 1;
    if (isWrite) inflight[node].writes -= 1;
  };
  res.on("finish", release);
  res.on("close", release);

  als.run({ node }, next);
}

// Called by the error handler when a query failed because the DB is unreachable: probe right away
// instead of waiting for the next interval (the thresholds still apply).
function reportConnectionError(err) {
  if (isConnectionError(err)) setImmediate(() => tick().catch(() => {}));
}

// ---- Health checks --------------------------------------------------------------------------------

async function probe(nodeName) {
  const node = ensureNodes()[nodeName];
  const h = nodeName === "A" ? state.a : state.b;
  if (!node.db) {
    h.status = "unconfigured";
    return false;
  }
  const started = Date.now();
  let ok = true;
  try {
    await withTimeout(node.db.$queryRawUnsafe("SELECT 1"), cfg.checkTimeoutMs, `${nodeName} health check`);
  } catch (err) {
    ok = false;
    if (h.status !== "down") logger.warn("ha_db_check_failed", { node: nodeName, message: err.message });
  }
  h.lastCheckedAt = new Date().toISOString();
  h.latencyMs = Date.now() - started;
  h.status = ok ? "up" : "down";
  if (ok) {
    h.consecutiveSuccesses += 1;
    h.consecutiveFailures = 0;
  } else {
    h.consecutiveFailures += 1;
    h.consecutiveSuccesses = 0;
  }
  return ok;
}

async function refreshOutboxPending() {
  if (state.b.status !== "up") return;
  try {
    const { pendingCount } = require("./syncEngine");
    state.outboxPending = await withTimeout(pendingCount(ensureNodes().B), cfg.checkTimeoutMs, "outbox count");
  } catch (err) {
    logger.warn("ha_outbox_count_failed", { message: err.message });
  }
}

// ---- State machine --------------------------------------------------------------------------------

function transition(to, reason, extra = {}) {
  const from = state.mode;
  if (from === to) return;
  state.mode = to;
  state.active = to === STATES.A_ACTIVE ? "A" : "B";
  if (to === STATES.A_ACTIVE) state.writesPaused = false;
  const entry = { at: new Date().toISOString(), from, to, reason, ...extra };
  state.lastTransition = entry;
  state.transitions = [entry, ...state.transitions].slice(0, 20);
  logger.warn("ha_db_transition", { ...entry, outboxPending: state.outboxPending, a: state.a.status, b: state.b.status });
  for (const fn of listeners) {
    try {
      fn(entry);
    } catch (err) {
      logger.error("ha_transition_listener_failed", { message: err.message });
    }
  }
}

function onTransition(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(predicate, timeoutMs, stepMs = 50) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) return false;
    await sleep(stepMs);
  }
  return true;
}

// Replays B's outbox to A while B keeps serving, then performs the paused final drain + flip.
async function drainAndCutover() {
  const { drain, pendingCount } = require("./syncEngine");
  const { A, B } = ensureNodes();

  // Phase 1: bulk replay with writes still open.
  await drain(B, A, { batchSize: cfg.drainBatchSize });
  state.outboxPending = await pendingCount(B);
  if (state.mode !== STATES.DRAINING) return;
  if (state.outboxPending > cfg.finalDrainThreshold) return; // more came in; next tick continues
  if (state.a.consecutiveSuccesses < cfg.recoverThreshold) return;

  // Phase 2: final drain. Pause writes, let in-flight B writes finish, drain to zero, flip.
  state.writesPaused = true;
  logger.warn("ha_final_drain_started", { outboxPending: state.outboxPending });
  const deadline = Date.now() + cfg.finalDrainTimeoutMs;
  try {
    const quiet = await waitFor(() => inflight.B.writes === 0, cfg.finalDrainTimeoutMs);
    if (!quiet) throw new Error("in-flight writes on B did not finish in time");
    for (;;) {
      await drain(B, A, { batchSize: cfg.drainBatchSize });
      state.outboxPending = await pendingCount(B);
      if (state.outboxPending === 0) break;
      if (Date.now() > deadline) throw new Error(`outbox still has ${state.outboxPending} pending rows`);
      if (state.mode !== STATES.DRAINING) throw new Error("A failed again during the final drain");
      await sleep(100);
    }
    transition(STATES.A_ACTIVE, "drain_complete");
  } catch (err) {
    logger.warn("ha_final_drain_aborted", { message: err.message });
  } finally {
    state.writesPaused = false;
  }
}

function startDrain() {
  if (draining) return;
  draining = drainAndCutover()
    .catch((err) => logger.warn("ha_drain_failed", { message: err.message }))
    .finally(() => {
      draining = null;
    });
}

// Leftovers journaled on B by requests that were already running when the flip happened.
async function residualDrain() {
  const { drain } = require("./syncEngine");
  const { A, B } = ensureNodes();
  await drain(B, A, { batchSize: cfg.drainBatchSize });
}

async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    await Promise.all([probe("A"), probe("B")]);
    await refreshOutboxPending();

    const { a, b } = state;
    switch (state.mode) {
      case STATES.A_ACTIVE:
        if (a.consecutiveFailures >= cfg.failThreshold) {
          if (b.status === "up") transition(STATES.B_ACTIVE, "a_unreachable", { failures: a.consecutiveFailures });
          else if (a.consecutiveFailures === cfg.failThreshold) logger.error("ha_both_databases_down");
        } else if (a.status === "up" && b.status === "up" && state.outboxPending > 0 && !draining) {
          draining = residualDrain()
            .catch((err) => logger.warn("ha_residual_drain_failed", { message: err.message }))
            .finally(() => {
              draining = null;
            });
        }
        break;

      case STATES.B_ACTIVE:
        if (a.consecutiveSuccesses >= cfg.recoverThreshold) {
          transition(STATES.DRAINING, "a_recovered", { successes: a.consecutiveSuccesses });
          startDrain();
        } else if (b.consecutiveFailures >= cfg.bFailThreshold && a.status === "up") {
          // B died while A answers again (but not yet M times): serve from A rather than from nothing.
          transition(STATES.A_ACTIVE, "b_unreachable_forced", { outboxDeferred: true });
        }
        break;

      case STATES.DRAINING:
        if (a.consecutiveFailures >= cfg.failThreshold) {
          transition(STATES.B_ACTIVE, "a_failed_during_drain", { failures: a.consecutiveFailures });
        } else if (b.consecutiveFailures >= cfg.bFailThreshold && a.status === "up") {
          // Outbox can't be read: flip to A now, the remaining rows replay (LWW) once B is back.
          transition(STATES.A_ACTIVE, "b_unreachable_forced", { outboxDeferred: true });
        } else {
          startDrain();
        }
        break;
      default:
        break;
    }
  } finally {
    ticking = false;
  }
}

async function start() {
  ensureNodes();
  await tick().catch((err) => logger.error("ha_router_tick_failed", { message: err.message }));
  // Booting while A is already down: don't wait N intervals with no DB at all.
  if (state.a.status !== "up" && state.b.status === "up") transition(STATES.B_ACTIVE, "a_unreachable_at_boot");
  // Restarted after an outage with B's outbox not replayed yet: keep serving from B until it is.
  else if (state.a.status === "up" && state.b.status === "up" && state.outboxPending > 0) {
    state.mode = STATES.B_ACTIVE; // so the transition below is logged as B_ACTIVE -> DRAINING
    state.active = "B";
    transition(STATES.DRAINING, "outbox_pending_at_boot", { outboxPending: state.outboxPending });
    startDrain();
  }
  timer = setInterval(() => tick().catch((err) => logger.error("ha_router_tick_failed", { message: err.message })), cfg.checkIntervalMs);
  timer.unref?.();
  logger.info("ha_router_started", { ...cfg, mode: state.mode });
}

async function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  if (draining) await draining.catch(() => {});
  if (nodes) await disconnectNodes(nodes);
}

function getStatus() {
  const activeHealth = state.active === "A" ? state.a : state.b;
  const canServe = state.a.status === "up" || state.b.status === "up";
  return {
    canServe,
    activeUp: activeHealth.status === "up",
    db: {
      active: state.active,
      state: state.mode,
      a: state.a.status,
      b: state.b.status,
      writesPaused: state.writesPaused,
      details: { a: { ...state.a }, b: { ...state.b } },
      lastTransition: state.lastTransition,
      transitions: state.transitions,
    },
    // null = unknown (B unreachable or not read yet): never reported as 0, the app's failback gate relies on it.
    outboxPending: state.b.status === "up" ? state.outboxPending : null,
    inflight: { A: { ...inflight.A }, B: { ...inflight.B } },
  };
}

module.exports = {
  STATES,
  getDb,
  getStorage,
  getNodes,
  pinRequest,
  reportConnectionError,
  onTransition,
  start,
  stop,
  getStatus,
  tick, // exported for tests / manual probing
};
