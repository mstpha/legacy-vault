const { getDb } = require("../config/db");
const logger = require("../config/logger");
const { writeAuditLog } = require("./audit.service");
const { createNotification } = require("./notification.service");

// Inactivity engine (RM4 / RM10), rewritten in Sprint 6 for scale.
//
// Before: findMany() of EVERY active capsule + its testator, then one UPDATE, one notification and
// one fire-and-forget audit transaction per capsule, in a sequential loop (N+1, unbounded memory,
// unbounded concurrent audit transactions fighting over the chain's advisory lock).
//
// Now: the "who is due?" decision is made by Postgres in one set-based UPDATE ... RETURNING, in
// batches. FOR UPDATE SKIP LOCKED makes it safe to run on several workers at once, and the
// `state = ...` guard in the WHERE clause means a capsule can only ever be moved once per transition
// (no double alert, no race with confirm-activity / revoke). Side effects (notifications, audit)
// then run with bounded concurrency so the Prisma connection pool is never exhausted.

const BATCH_SIZE = Number(process.env.SWEEP_BATCH_SIZE || 500);
const NOTIFY_CONCURRENCY = Number(process.env.SWEEP_NOTIFY_CONCURRENCY || 5);
const TOKEN_RETENTION_DAYS = Number(process.env.REFRESH_TOKEN_RETENTION_DAYS || 7);

// Heartbeat read by GET /health/ready, so uptime monitoring notices a sweep that silently stopped.
const sweepStatus = { lastRunAt: null, lastDurationMs: null, lastResult: null, lastError: null };
function getSweepStatus() {
  return { ...sweepStatus };
}

async function inChunks(items, size, fn) {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn));
  }
}

// A failed notification must not abort the sweep: the state change is already committed, and
// the in-app inbox row is the source of truth the next sweep cannot recreate.
async function safely(label, fn) {
  try {
    await fn();
  } catch (err) {
    logger.error(`sweep_${label}_failed`, { message: err.message });
  }
}

// ACTIVE -> INACTIVITY_ALERT: the testator's last activity is older than the capsule's own threshold.
// Activity = users.lastSeenAt (falls back to the capsule's creation date for a testator never seen).
async function alertBatch() {
  return getDb().$queryRaw`
    WITH due AS (
      SELECT c.id
      FROM capsules c
      JOIN users u ON u.id = c."testatorId"
      WHERE c.state = 'ACTIVE'::"CapsuleState"
        AND COALESCE(u."lastSeenAt", c."createdAt")
            <= (now() AT TIME ZONE 'UTC') - (c."inactivityThresholdDays" * interval '1 day')
      ORDER BY c.id
      LIMIT ${BATCH_SIZE}::int
      FOR UPDATE OF c SKIP LOCKED
    )
    UPDATE capsules c
    SET state = 'INACTIVITY_ALERT'::"CapsuleState",
        "alertSentAt" = (now() AT TIME ZONE 'UTC'),
        "graceWindowExpiresAt" = (now() AT TIME ZONE 'UTC') + (c."graceWindowDays" * interval '1 day'),
        "updatedAt" = (now() AT TIME ZONE 'UTC')
    FROM due
    WHERE c.id = due.id AND c.state = 'ACTIVE'::"CapsuleState"
    RETURNING c.id, c."testatorId", c."graceWindowExpiresAt"
  `;
}

async function processActiveCapsules() {
  let total = 0;
  for (;;) {
    const rows = await alertBatch();
    if (rows.length === 0) break;

    await inChunks(rows, NOTIFY_CONCURRENCY, (row) =>
      safely("alert_notification", () =>
        createNotification(row.testatorId, "INACTIVITY_ALERT", {
          capsuleId: row.id,
          graceWindowExpiresAt: row.graceWindowExpiresAt,
        })
      )
    );
    // Audit entries are chained one after the other anyway (advisory lock), so write them in order.
    for (const row of rows) await writeAuditLog({ capsuleId: row.id, action: "INACTIVITY_ALERT_TRIGGERED" });

    total += rows.length;
    if (rows.length < BATCH_SIZE) break;
  }
  return total;
}

// INACTIVITY_ALERT -> PENDING_VALIDATION: the grace window expired with no response from the testator.
// (The way back to ACTIVE is capsule.service#confirmActivity, not this sweep.)
async function escalateBatch() {
  return getDb().$queryRaw`
    UPDATE capsules
    SET state = 'PENDING_VALIDATION'::"CapsuleState",
        "updatedAt" = (now() AT TIME ZONE 'UTC')
    WHERE id IN (
      SELECT id
      FROM capsules
      WHERE state = 'INACTIVITY_ALERT'::"CapsuleState"
        AND "graceWindowExpiresAt" <= (now() AT TIME ZONE 'UTC')
      ORDER BY id
      LIMIT ${BATCH_SIZE}::int
      FOR UPDATE SKIP LOCKED
    )
    AND state = 'INACTIVITY_ALERT'::"CapsuleState"
    RETURNING id
  `;
}

async function processAlertingCapsules() {
  let total = 0;
  for (;;) {
    const rows = await escalateBatch();
    if (rows.length === 0) break;
    const ids = rows.map((r) => r.id);

    // One query for all guarantors of the batch (was one query per capsule).
    const guarantors = await getDb().capsuleGuarantor.findMany({
      where: { capsuleId: { in: ids } },
      select: { capsuleId: true, userId: true },
    });

    await inChunks(guarantors, NOTIFY_CONCURRENCY, (g) =>
      safely("validation_notification", () =>
        createNotification(g.userId, "VALIDATION_REQUEST", { capsuleId: g.capsuleId })
      )
    );
    for (const id of ids) await writeAuditLog({ capsuleId: id, action: "ESCALATED_TO_PENDING_VALIDATION" });

    total += rows.length;
    if (rows.length < BATCH_SIZE) break;
  }
  return total;
}

// Housekeeping: refresh_tokens grows by one row per login and per refresh, forever. Expired rows
// are useless (and the revoked ones past retention are no use for theft investigation either).
async function purgeExpiredRefreshTokens() {
  const cutoff = new Date(Date.now() - TOKEN_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const { count } = await getDb().refreshToken.deleteMany({ where: { expiresAt: { lt: cutoff } } });
  return count;
}

async function runInactivitySweep() {
  const startedAt = Date.now();
  try {
    const alertsSent = await processActiveCapsules();
    const escalatedToValidation = await processAlertingCapsules();
    const purgedTokens = await purgeExpiredRefreshTokens().catch((err) => {
      logger.warn("refresh_token_purge_failed", { message: err.message });
      return 0;
    });

    const result = { alertsSent, escalatedToValidation, purgedTokens };
    Object.assign(sweepStatus, {
      lastRunAt: new Date(),
      lastDurationMs: Date.now() - startedAt,
      lastResult: result,
      lastError: null,
    });
    return result;
  } catch (err) {
    Object.assign(sweepStatus, { lastDurationMs: Date.now() - startedAt, lastError: err.message });
    throw err;
  }
}

module.exports = { runInactivitySweep, getSweepStatus };
