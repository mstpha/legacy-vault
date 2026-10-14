const crypto = require("crypto");
const prisma = require("../config/db");
const logger = require("../config/logger");
const { ApiError } = require("../middleware/errorHandler");

// Tamper-evident audit log (Sprint 5).
//
// Every entry stores:   hash = SHA-256( prevHash + this entry's own content )
// so each row is cryptographically tied to the one before it. Changing, removing or
// re-ordering ANY past entry changes its hash, which no longer matches the next row's
// prevHash, and verifyAuditChain() reports exactly where. Database triggers (see
// prisma/rls-policies.sql) additionally refuse UPDATE/DELETE/TRUNCATE on the table.

const GENESIS = "GENESIS"; // prevHash of the very first chained entry
const CHAIN_LOCK_ID = 740001; // arbitrary constant: the Postgres advisory lock key for the chain
const VERIFY_BATCH = 500;

// jsonb does not preserve key order, so hashes must be computed over a canonical form:
// keys sorted recursively, dates turned into ISO strings (the JSON round-trip does that).
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((out, key) => {
        out[key] = sortKeys(value[key]);
        return out;
      }, {});
  }
  return value;
}

function canonicalize(value) {
  return JSON.stringify(sortKeys(JSON.parse(JSON.stringify(value ?? null))));
}

function computeHash({ prevHash, userId, capsuleId, action, createdAt, metadata }) {
  const payload = canonicalize([
    prevHash,
    userId || null,
    capsuleId || null,
    action,
    new Date(createdAt).toISOString(),
    metadata ?? null,
  ]);
  return crypto.createHash("sha256").update(payload).digest("hex");
}

// Appends one entry to the chain. Never throws: an audit failure must not block the
// action that triggered it, but it is logged loudly so it can't go unnoticed.
async function writeAuditLog({ userId, capsuleId, action, metadata }) {
  try {
    await prisma.$transaction(
      async (tx) => {
        // One writer at a time, otherwise two concurrent entries could both build on the
        // same "previous" hash and fork the chain. The lock is released automatically at COMMIT.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CHAIN_LOCK_ID})`;

        const last = await tx.auditLog.findFirst({
          where: { hash: { not: null } },
          orderBy: { seq: "desc" },
          select: { hash: true },
        });

        const prevHash = last ? last.hash : GENESIS;
        const createdAt = new Date();
        const hash = computeHash({ prevHash, userId, capsuleId, action, createdAt, metadata });

        await tx.auditLog.create({
          data: {
            userId: userId || null,
            capsuleId: capsuleId || null,
            action,
            metadata: metadata ?? undefined,
            prevHash,
            hash,
            createdAt,
          },
        });
      },
      { maxWait: 10000, timeout: 15000 }
    );
  } catch (err) {
    logger.error("Failed to write audit log", { action, err: err.message });
  }
}

// Pure check of consecutive rows (ascending seq) against the running state.
// Returns the first problem found, or null if every row is consistent.
function checkRows(rows, state) {
  for (const row of rows) {
    if (row.prevHash !== state.prevHash) {
      return { seq: row.seq, id: row.id, reason: "Link broken: an entry was removed, inserted or re-ordered before this one." };
    }
    if (row.hash !== computeHash(row)) {
      return { seq: row.seq, id: row.id, reason: "Content does not match its hash: this entry was modified." };
    }
    state.prevHash = row.hash;
    state.checked += 1;
  }
  return null;
}

// Re-computes the whole chain from the first hashed entry onwards.
// Entries from before Sprint 5 have no hash ("legacy") and are reported but not checked.
async function verifyAuditChain() {
  const [first, legacyUnchained] = await Promise.all([
    prisma.auditLog.findFirst({ where: { hash: { not: null } }, orderBy: { seq: "asc" }, select: { seq: true } }),
    prisma.auditLog.count({ where: { hash: null } }),
  ]);

  if (!first) return { valid: true, checked: 0, legacyUnchained, brokenAt: null };

  // After the chain starts, an entry WITHOUT a hash can only have been slipped in.
  const stray = await prisma.auditLog.findFirst({
    where: { hash: null, seq: { gt: first.seq } },
    select: { seq: true, id: true },
  });
  if (stray) {
    return {
      valid: false,
      checked: 0,
      legacyUnchained,
      brokenAt: { ...stray, reason: "An entry without a hash was added after the chain started." },
    };
  }

  const state = { prevHash: GENESIS, checked: 0 };
  let cursor = first.seq - 1;

  for (;;) {
    const rows = await prisma.auditLog.findMany({
      where: { seq: { gt: cursor }, hash: { not: null } },
      orderBy: { seq: "asc" },
      take: VERIFY_BATCH,
    });
    if (rows.length === 0) break;

    const broken = checkRows(rows, state);
    if (broken) return { valid: false, checked: state.checked, legacyUnchained, brokenAt: broken };
    cursor = rows[rows.length - 1].seq;
  }

  return { valid: true, checked: state.checked, legacyUnchained, brokenAt: null };
}

// --- Reading the log (admin screen) -----------------------------------------------------

// Filter groups used by the admin screen. Actions not listed here still show under "all".
const ACTION_GROUPS = {
  accounts: ["USER_REGISTERED", "USER_LOGGED_IN", "USER_LOGGED_OUT", "MFA_ENABLED", "MFA_DISABLED", "MFA_LOGIN_REJECTED"],
  capsules: [
    "CAPSULE_CREATED", "CAPSULE_UPDATED", "CAPSULE_DELETED", "CAPSULE_ACTIVATED", "CAPSULE_REVOKED", "THRESHOLDS_UPDATED",
    "FILE_ATTACHED", "GUARANTOR_ADDED", "GUARANTOR_REMOVED", "BENEFICIARY_ADDED", "BENEFICIARY_REMOVED", "ACTIVITY_CONFIRMED",
  ],
  lifecycle: ["INACTIVITY_ALERT_TRIGGERED", "ESCALATED_TO_PENDING_VALIDATION", "VALIDATION_SUBMITTED", "CAPSULE_UNLOCKED"],
  access: [
    "CAPSULE_CONTENT_ACCESSED", "FILE_DOWNLOADED", "CAPSULE_FIRST_ACCESS", "CAPSULE_ARCHIVED", "ACCESS_ATTEMPT_BLOCKED", "KEY_SHARE_DELIVERED",
  ],
  security: ["PERMISSION_CHANGED", "PUBLIC_KEY_REGISTERED", "PUBLIC_KEY_CHANGED", "PUBLIC_KEY_REMOVED", "KEY_SHARES_UPDATED"],
};

// Newest first, 30 at a time. `before` is the seq of the last entry already shown.
async function listAuditEntries({ before, limit, group, capsuleId } = {}) {
  const take = Math.min(Math.max(parseInt(limit, 10) || 30, 1), 100);

  const where = {};
  if (before !== undefined && before !== "") {
    const cursor = Number(before);
    if (!Number.isInteger(cursor) || cursor < 1) throw new ApiError(400, "before must be a positive whole number.");
    where.seq = { lt: cursor };
  }
  if (group) {
    if (!ACTION_GROUPS[group]) throw new ApiError(400, `Unknown group "${group}".`);
    where.action = { in: ACTION_GROUPS[group] };
  }
  if (capsuleId) {
    if (typeof capsuleId !== "string" || capsuleId.length > 64) throw new ApiError(400, "Invalid capsuleId.");
    where.capsuleId = capsuleId;
  }

  const rows = await prisma.auditLog.findMany({ where, orderBy: { seq: "desc" }, take: take + 1 });
  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;

  // The log keeps plain ids (no foreign keys, so history survives deletions): look up names here.
  const userIds = [...new Set(page.map((r) => r.userId).filter(Boolean))];
  const capsuleIds = [...new Set(page.map((r) => r.capsuleId).filter(Boolean))];
  const [users, capsules] = await Promise.all([
    userIds.length ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true, fullName: true } }) : [],
    capsuleIds.length ? prisma.capsule.findMany({ where: { id: { in: capsuleIds } }, select: { id: true, title: true } }) : [],
  ]);
  const userById = new Map(users.map((u) => [u.id, u]));
  const capsuleById = new Map(capsules.map((c) => [c.id, c]));

  return {
    entries: page.map((r) => ({
      seq: r.seq,
      createdAt: r.createdAt,
      action: r.action,
      userId: r.userId,
      userEmail: userById.get(r.userId)?.email || null,
      userName: userById.get(r.userId)?.fullName || null,
      capsuleId: r.capsuleId,
      capsuleTitle: capsuleById.get(r.capsuleId)?.title || null, // null = deleted, or no capsule involved
      metadata: r.metadata || null,
      chained: !!r.hash, // false for entries from before the hash chain existed
    })),
    nextCursor: hasMore ? page[page.length - 1].seq : null,
  };
}

module.exports = { writeAuditLog, verifyAuditChain, listAuditEntries, ACTION_GROUPS, computeHash, checkRows, GENESIS };
