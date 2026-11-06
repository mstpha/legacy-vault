import axios from "axios";
import { AppState, Platform } from "react-native";
import { PRIMARY_API_URL, BACKUP_API_URL, HA_CONFIG, healthUrlFor } from "../config";

// Health store + background prober + routing decision for the HA failover client (client.js).
//
// Routing, before each request, from cached state only:
//   active=primary, primary up and fresh (< HEALTH_TTL_MS)    -> primary, no extra call
//   active=primary, primary marked down                        -> fail over to backup
//   state stale/unknown                                        -> ONE shared preflight GET /health
// Failback (backup -> primary) only after FAILBACK_HEALTHY_PROBES consecutive healthy primary probes,
// AND, if the backup served from Supabase B during this episode, once the backup reports
// state A_ACTIVE with outboxPending 0 (B's writes are replayed to A, so the primary sees them).

export const SERVERS = {
  primary: { apiUrl: PRIMARY_API_URL, healthUrl: healthUrlFor(PRIMARY_API_URL) },
  backup: { apiUrl: BACKUP_API_URL, healthUrl: healthUrlFor(BACKUP_API_URL) },
};

const probeTransport = axios.create({ validateStatus: () => true });

const newServerHealth = () => ({ status: "unknown", lastChecked: 0, consecutiveFailures: 0, consecutiveSuccesses: 0 });

const store = {
  primary: newServerHealth(),
  backup: { ...newServerHealth(), db: null, outboxPending: null },
  active: "primary",
  backupUsedB: false, // backup was on B_ACTIVE / DRAINING since we last failed over
};

const listeners = new Set();
let snapshot = null;

function emit() {
  snapshot = null;
  listeners.forEach((fn) => fn());
}

export function subscribe(fn) {
  listeners.add(fn);
  ensureMonitor();
  return () => listeners.delete(fn);
}

// Stable object between changes (useSyncExternalStore requirement).
export function getSnapshot() {
  if (!snapshot) {
    const db = store.backup.db;
    const backupDb = !db ? null : db.state === "DRAINING" ? "draining" : db.active;
    let label = null;
    if (store.active === "backup") {
      label = "Backup server";
      if (backupDb === "B") label = "Backup server, degraded: backup database";
      else if (backupDb === "draining") label = "Backup server, degraded: database resyncing";
    }
    if (store.primary.status === "down" && store.backup.status === "down") label = "Servers unreachable";
    snapshot = {
      activeServer: store.active,
      backupDb, // "A" | "B" | "draining" | null
      label,
      primary: { ...store.primary },
      backup: { ...store.backup },
    };
  }
  return snapshot;
}

const isFresh = (h) => Date.now() - h.lastChecked < HA_CONFIG.healthTtlMs;

function setActive(server, reason) {
  if (store.active === server) return;
  store.active = server;
  if (server === "backup") store.backupUsedB = false;
  if (__DEV__) console.log(`[ha] routing to ${server} (${reason})`);
  emit();
}

function record(server, ok) {
  const h = store[server];
  h.lastChecked = Date.now();
  h.status = ok ? "up" : "down";
  if (ok) {
    h.consecutiveSuccesses += 1;
    h.consecutiveFailures = 0;
  } else {
    h.consecutiveFailures += 1;
    h.consecutiveSuccesses = 0;
  }
}

function evaluateRouting() {
  const { primary, backup } = store;
  if (store.active === "primary") {
    if (primary.status === "down" && backup.status !== "down") setActive("backup", "primary unhealthy");
    return;
  }
  // On backup.
  if (backup.status === "down" && primary.status === "up") {
    setActive("primary", "backup unreachable"); // anything beats no server; B's outbox replays later
    return;
  }
  if (primary.consecutiveSuccesses < HA_CONFIG.failbackHealthyProbes) return;
  if (store.backupUsedB) {
    const db = backup.db;
    if (backup.status !== "up" || !db || db.state !== "A_ACTIVE" || backup.outboxPending !== 0) return;
  }
  setActive("primary", "failback gate passed");
}

// ---- Probing ------------------------------------------------------------------------------------

const inflight = { primary: null, backup: null };

// Deduplicated: concurrent callers share the same probe.
export function probe(server, timeoutMs = HA_CONFIG.preflightTimeoutMs * 3) {
  if (inflight[server]) return inflight[server];
  inflight[server] = (async () => {
    let ok = false;
    try {
      const res = await probeTransport.get(SERVERS[server].healthUrl, { timeout: timeoutMs });
      ok = res.status === 200;
      if (server === "backup" && res.data && typeof res.data === "object") {
        store.backup.db = res.data.db || null;
        store.backup.outboxPending = typeof res.data.outboxPending === "number" ? res.data.outboxPending : null;
        if (res.data.db && res.data.db.state !== "A_ACTIVE") store.backupUsedB = true;
      }
    } catch (err) {
      ok = false;
    }
    record(server, ok);
    evaluateRouting();
    emit();
    return ok;
  })().finally(() => {
    inflight[server] = null;
  });
  return inflight[server];
}

export function probeAll() {
  return Promise.all([probe("primary"), probe("backup")]);
}

// ---- Called by the client -----------------------------------------------------------------------

export async function pickServer() {
  ensureMonitor();
  const server = store.active;
  const h = store[server];
  if (h.status === "up" && isFresh(h)) return server;
  if (h.status === "down" && isFresh(h)) {
    const other = server === "primary" ? "backup" : "primary";
    if (store[other].status !== "down" || !isFresh(store[other])) {
      if (server === "primary") setActive("backup", "primary marked down");
      return other;
    }
    return server; // both down: let the request-level retries decide
  }
  // Stale or unknown: one shared preflight.
  const ok = await probe(server, HA_CONFIG.preflightTimeoutMs);
  if (ok) return server;
  return store.active === server ? (server === "primary" ? "backup" : "primary") : store.active;
}

// Request-level evidence. A failure marks the server down immediately (the failback gate still
// needs N healthy *probes*); a success only refreshes freshness, it does not count as a probe.
export function markDown(server) {
  record(server, false);
  evaluateRouting();
  emit();
}

export function markUp(server) {
  const h = store[server];
  const changed = h.status !== "up";
  h.status = "up";
  h.lastChecked = Date.now();
  if (changed) emit();
}

// ---- Background prober ----------------------------------------------------------------------------

let timer = null;
let started = false;

function startTimer() {
  if (timer) return;
  timer = setInterval(probeAll, HA_CONFIG.healthProbeIntervalMs);
}

function stopTimer() {
  if (timer) clearInterval(timer);
  timer = null;
}

function resume() {
  probeAll();
  startTimer();
}

// Starts lazily on the first request or subscriber. Pauses while backgrounded / offline, and probes
// immediately when the app comes back or the network reconnects.
export function ensureMonitor() {
  if (started) return;
  started = true;
  if (AppState.currentState === "active" || AppState.currentState == null) resume();
  AppState.addEventListener("change", (s) => (s === "active" ? resume() : stopTimer()));
  // Web: real online/offline events. Native has no built-in signal without @react-native-community/netinfo;
  // there the AppState resume + per-request failures cover reconnects.
  if (Platform.OS === "web" && typeof window !== "undefined" && window.addEventListener) {
    window.addEventListener("online", resume);
    window.addEventListener("offline", stopTimer);
  }
}

export function stopMonitor() {
  stopTimer();
}
