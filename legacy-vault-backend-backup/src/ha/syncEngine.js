const logger = require("../config/logger");
const { computeHash, GENESIS } = require("../services/audit.service");
const { isConnectionError } = require("./clients");

// Moves change_log rows from one project to the other. Used by:
//   - the sync worker (A -> B continuously, B -> A whenever B has an outbox)
//   - the backup's DB router (B -> A during DRAINING, so cutover does not depend on the worker)
// Both can run at the same time: rows are leased with FOR UPDATE SKIP LOCKED.

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "capsule-files";
const MAX_ATTEMPTS = Number(process.env.SYNC_MAX_ATTEMPTS || 10);
const AUDIT_CHAIN_LOCK_ID = 740001; // same advisory lock key as audit.service
// Leasing a batch holds a transaction open on the source while the target is written.
const LEASE_TIMEOUT_MS = Number(process.env.SYNC_LEASE_TIMEOUT_MS || 120000);

class RetriableSyncError extends Error {}

const toNumber = (v) => (typeof v === "bigint" ? Number(v) : Number(v || 0));

// timestamp(3) columns come out of to_jsonb() without an offset; they are UTC (Prisma writes UTC).
const asUtcDate = (s) => new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`);

async function pendingCount(node) {
  const [row] = await node.db.$queryRawUnsafe(`SELECT count(*)::bigint AS n FROM ha.change_log WHERE status = 'pending'`);
  return toNumber(row.n);
}

async function recordSyncAudit(node, { source, runId, schemaName, tableName, rowId, action, detail }) {
  try {
    await node.db.$executeRawUnsafe(
      `INSERT INTO ha.sync_audit (source, run_id, schema_name, table_name, row_id, action, detail)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      source,
      runId || null,
      schemaName || null,
      tableName || null,
      rowId || null,
      action,
      JSON.stringify(detail ?? null)
    );
  } catch (err) {
    logger.error("sync_audit_write_failed", { node: node.name, action, message: err.message });
  }
}

// ---- Storage objects ------------------------------------------------------------------------
// Storage is not in the trigger set (storage.objects is owned by Supabase, no triggers allowed on
// hosted projects), so objects follow their capsule_files row: copied before the row is applied,
// removed after the row's delete is applied.

async function objectExists(node, path) {
  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  const name = path.slice(path.lastIndexOf("/") + 1);
  const { data, error } = await node.supabase.storage.from(BUCKET).list(dir, { search: name, limit: 100 });
  if (error) throw new RetriableSyncError(`storage list on ${node.name} failed: ${error.message}`);
  return (data || []).some((o) => o.name === name);
}

async function copyObject(source, target, path) {
  if (!source.supabase || !target.supabase) throw new RetriableSyncError("storage client not configured");
  if (await objectExists(target, path)) return "exists";

  const { data, error } = await source.supabase.storage.from(BUCKET).download(path);
  if (error) {
    // Already gone at the source (deleted since): nothing to copy, the row delete will follow.
    if (/not.?found|404/i.test(`${error.message} ${error.statusCode || ""}`)) return "missing_at_source";
    throw new RetriableSyncError(`storage download on ${source.name} failed: ${error.message}`);
  }
  const bytes = Buffer.from(await data.arrayBuffer());
  const up = await target.supabase.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: "application/octet-stream", upsert: true });
  if (up.error) throw new RetriableSyncError(`storage upload on ${target.name} failed: ${up.error.message}`);
  return "copied";
}

async function removeObject(target, path) {
  if (!target.supabase || !path) return;
  const { error } = await target.supabase.storage.from(BUCKET).remove([path]);
  if (error) throw new RetriableSyncError(`storage remove on ${target.name} failed: ${error.message}`);
}

// ---- Applying one change ----------------------------------------------------------------------

// A's audit log is the authoritative, append-only hash chain. Entries written on B during an outage
// are appended to A's chain (new seq, prevHash and hash; same id, content and createdAt) instead of
// being copied verbatim, which would fork the chain. This insert is NOT run with ha.applying, so A's
// trigger journals it and the re-chained version flows back to B's mirror like any other A write.
async function rechainAuditEntryOnA(target, p) {
  return target.db.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${AUDIT_CHAIN_LOCK_ID})`);
      const existing = await tx.$queryRawUnsafe(`SELECT 1 FROM public.audit_logs WHERE id = $1`, p.id);
      if (existing.length) return "skipped_duplicate";

      const [last] = await tx.$queryRawUnsafe(
        `SELECT hash FROM public.audit_logs WHERE hash IS NOT NULL ORDER BY seq DESC LIMIT 1`
      );
      const prevHash = last ? last.hash : GENESIS;
      const createdAt = asUtcDate(p.createdAt);
      // Entries from before the chain existed stay unchained.
      const hash =
        p.hash == null
          ? null
          : computeHash({ prevHash, userId: p.userId, capsuleId: p.capsuleId, action: p.action, createdAt, metadata: p.metadata });

      await tx.$executeRawUnsafe(
        `INSERT INTO public.audit_logs (id, "userId", "capsuleId", action, metadata, "prevHash", hash, "createdAt")
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8::timestamp(3))`,
        p.id,
        p.userId,
        p.capsuleId,
        p.action,
        p.metadata == null ? null : JSON.stringify(p.metadata),
        p.hash == null ? null : prevHash,
        hash,
        createdAt.toISOString().replace("Z", "")
      );
      return "applied";
    },
    { maxWait: 10000, timeout: 15000 }
  );
}

async function applyGeneric(target, change) {
  const [row] = await target.db.$queryRawUnsafe(
    `SELECT ha.apply_change($1, $2, $3, $4, $5::jsonb, $6::timestamptz, $7) AS result`,
    change.schema_name,
    change.table_name,
    change.op,
    change.row_id,
    JSON.stringify(change.payload),
    new Date(change.changed_at).toISOString(),
    change.origin
  );
  return row.result;
}

// For a capsule_files DELETE the payload only carries {id}: look the path up on the target first.
async function storagePathOnTarget(target, rowId) {
  const rows = await target.db.$queryRawUnsafe(`SELECT "storagePath" FROM public.capsule_files WHERE id = $1`, rowId);
  return rows[0]?.storagePath || null;
}

async function applyChange(source, target, change) {
  const isAudit = change.schema_name === "public" && change.table_name === "audit_logs";
  const isFile = change.schema_name === "public" && change.table_name === "capsule_files";

  if (isAudit && target.name === "A") {
    // audit_logs never receives UPDATE/DELETE (append-only trigger on the source).
    return change.op === "INSERT" ? rechainAuditEntryOnA(target, change.payload) : "skipped";
  }

  if (isFile && change.op !== "DELETE" && change.payload.storagePath) {
    await copyObject(source, target, change.payload.storagePath);
  }

  const deletedPath = isFile && change.op === "DELETE" ? await storagePathOnTarget(target, change.row_id) : null;
  const result = await applyGeneric(target, change);
  if (result === "applied" && deletedPath) await removeObject(target, deletedPath);
  return result;
}

// ---- Draining a change log ------------------------------------------------------------------

// Applies up to `batchSize` pending changes of `source` to `target`, in id order.
// Connection/storage failures abort the batch (nothing is marked; it is retried later, re-applying
// whatever was already applied, which is idempotent). Data errors (unique email taken on the other
// side, FK to a row deleted there...) are retried MAX_ATTEMPTS times, then marked 'conflict' and
// logged to ha.sync_audit, so one bad row can never wedge the stream.
async function drainBatch(source, target, { batchSize = 200 } = {}) {
  const stats = { processed: 0, applied: 0, skipped: 0, conflicts: 0, deferred: 0 };

  await source.db.$transaction(
    async (tx) => {
      const rows = await tx.$queryRawUnsafe(
        `SELECT id, schema_name, table_name, op, row_id, payload, changed_at, origin, attempts
         FROM ha.change_log WHERE status = 'pending'
         ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED`,
        batchSize
      );
      const marks = []; // { id, status, error }

      for (const change of rows) {
        let result;
        try {
          result = await applyChange(source, target, change);
        } catch (err) {
          if (err instanceof RetriableSyncError || isConnectionError(err)) throw err;
          const attempts = change.attempts + 1;
          if (attempts >= MAX_ATTEMPTS) {
            marks.push({ id: change.id, status: "conflict", error: err.message, attempts });
            stats.conflicts += 1;
            await recordSyncAudit(target.name === "A" ? target : source, {
              source: "worker",
              schemaName: change.schema_name,
              tableName: change.table_name,
              rowId: change.row_id,
              action: "conflict",
              detail: { from: source.name, to: target.name, changeId: String(change.id), op: change.op, error: err.message },
            });
            logger.error("sync_conflict", { from: source.name, to: target.name, table: change.table_name, rowId: change.row_id, error: err.message });
            continue;
          }
          // Keep ordering: stop here and retry this row (and everything after it) next round.
          marks.push({ id: change.id, status: "pending", error: err.message, attempts });
          stats.deferred += 1;
          logger.warn("sync_apply_deferred", { from: source.name, to: target.name, table: change.table_name, rowId: change.row_id, attempts, error: err.message });
          break;
        }
        stats.processed += 1;
        if (result === "applied") {
          stats.applied += 1;
          marks.push({ id: change.id, status: "applied" });
        } else {
          stats.skipped += 1;
          marks.push({ id: change.id, status: "skipped", error: result });
        }
      }

      for (const m of marks) {
        await tx.$executeRawUnsafe(
          `UPDATE ha.change_log
           SET status = $2, last_error = $3, attempts = COALESCE($4, attempts),
               applied_at = CASE WHEN $2 = 'pending' THEN NULL ELSE now() END
           WHERE id = $1::bigint`,
          String(m.id),
          m.status,
          m.error || null,
          m.attempts ?? null
        );
      }
    },
    { maxWait: 5000, timeout: LEASE_TIMEOUT_MS }
  );

  return stats;
}

// Drains until the source has nothing pending (or `maxBatches` is reached).
async function drain(source, target, { batchSize = 200, maxBatches = Infinity } = {}) {
  const total = { processed: 0, applied: 0, skipped: 0, conflicts: 0, deferred: 0, batches: 0 };
  for (let i = 0; i < maxBatches; i++) {
    const s = await drainBatch(source, target, { batchSize });
    total.batches += 1;
    for (const k of ["processed", "applied", "skipped", "conflicts", "deferred"]) total[k] += s[k];
    if (s.deferred > 0) break; // a row is waiting on a retry; don't spin on it
    if (s.processed + s.conflicts < batchSize) break;
  }
  return total;
}

// ---- Housekeeping ------------------------------------------------------------------------------

async function housekeeping(node) {
  const changeLogDays = Number(process.env.SYNC_CHANGELOG_RETENTION_DAYS || 3);
  const tombstoneDays = Number(process.env.SYNC_TOMBSTONE_RETENTION_DAYS || 30);
  // Unjournaled: each project expires its own keys, the other one does the same on its side.
  const keys = await node.db.$queryRawUnsafe(
    `SELECT ha.exec_unjournaled('DELETE FROM ha.idempotency_keys WHERE expires_at < now()') AS n`
  );
  const log = await node.db.$executeRawUnsafe(
    `DELETE FROM ha.change_log WHERE status <> 'pending' AND applied_at < now() - ($1::int * interval '1 day')`,
    changeLogDays
  );
  const tomb = await node.db.$executeRawUnsafe(
    `DELETE FROM ha.row_versions WHERE deleted_at IS NOT NULL AND deleted_at < now() - ($1::int * interval '1 day')`,
    tombstoneDays
  );
  return { expiredIdempotencyKeys: toNumber(keys[0]?.n), purgedChangeLog: log, purgedTombstones: tomb };
}

module.exports = {
  BUCKET,
  RetriableSyncError,
  pendingCount,
  drain,
  drainBatch,
  applyChange,
  applyGeneric,
  copyObject,
  objectExists,
  recordSyncAudit,
  housekeeping,
  rechainAuditEntryOnA,
  toNumber,
};
