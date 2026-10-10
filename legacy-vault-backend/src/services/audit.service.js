const crypto = require("crypto");
const prisma = require("../config/db");
const logger = require("../config/logger");
const { writeAuditLog } = require("./audit.service");
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

module.exports = { writeAuditLog, verifyAuditChain, computeHash, checkRows, GENESIS };
