// sync-check: reconciles Supabase A and B table by table.
//
//   node src/ha/syncCheck.js [--dry-run] [--table=users,capsules] [--no-storage]
//   (npm run sync:check / npm run sync:check:dry)
//
// Per table: row counts, max row version (ha.row_versions), then a chunked merge-walk over
// (id, md5(row)) on both sides to find rows missing in B, extra in B, and diverged. Rows touched in
// the last SYNC_CHECK_GRACE_MS or still pending in a change log are skipped (in flight, not drift).
//
// Fix rule (same as the stream): last write wins on ha.row_versions.updated_at, tombstones included.
// No version on either side -> A is authoritative. audit_logs: A's chain is authoritative; entries
// only B has are re-chained onto A, never copied verbatim. Every fix is logged to ha.sync_audit.
//
// Also checks Storage: every capsule_files.storagePath must exist in both buckets.
// An unreachable project is reported and skipped, never a crash.
require("dotenv").config();
const crypto = require("crypto");
const logger = require("../config/logger");
const { createNodes, disconnectNodes, withTimeout } = require("./clients");
const { SYNCED_TABLES, qualified } = require("./tables");
const { applyGeneric, copyObject, objectExists, recordSyncAudit, rechainAuditEntryOnA } = require("./syncEngine");

const CHUNK = Number(process.env.SYNC_CHECK_CHUNK || 1000);
const GRACE_MS = Number(process.env.SYNC_CHECK_GRACE_MS || 60000);
const REACH_TIMEOUT_MS = Number(process.env.A_CHECK_TIMEOUT_MS || 1500) * 2;

const toNumber = (v) => (typeof v === "bigint" ? Number(v) : Number(v || 0));

async function reachable(node) {
  if (!node.db) return false;
  try {
    await withTimeout(node.db.$queryRawUnsafe("SELECT 1"), REACH_TIMEOUT_MS, `${node.name} reachability`);
    return true;
  } catch (err) {
    return false;
  }
}

async function tableStats(node, t) {
  const [c] = await node.db.$queryRawUnsafe(`SELECT count(*)::bigint AS n FROM ${qualified(t)}`);
  const [v] = await node.db.$queryRawUnsafe(
    `SELECT max(updated_at) AS max_updated FROM ha.row_versions WHERE schema_name = $1 AND table_name = $2`,
    t.schema,
    t.table
  );
  return { count: toNumber(c.n), maxUpdatedAt: v.max_updated };
}

// Ids that are legitimately in flight: pending in a change log, or written within the grace window.
async function inFlightIds(node, t) {
  const rows = await node.db.$queryRawUnsafe(
    `SELECT row_id FROM ha.change_log WHERE status = 'pending' AND schema_name = $1 AND table_name = $2
     UNION
     SELECT row_id FROM ha.row_versions WHERE schema_name = $1 AND table_name = $2
       AND updated_at > now() - ($3::int * interval '1 millisecond')`,
    t.schema,
    t.table,
    GRACE_MS
  );
  return new Set(rows.map((r) => r.row_id));
}

async function hashChunk(node, t, after) {
  return node.db.$queryRawUnsafe(
    `SELECT id, ha.row_hash(to_jsonb(x)) AS h FROM ${qualified(t)} x
     WHERE id COLLATE "C" > $1 ORDER BY id COLLATE "C" LIMIT $2`,
    after,
    CHUNK
  );
}

// Merge-walk both sides in id order (C collation on both, byte order = JS string order for these ids).
async function diffTable(A, B, t) {
  const diffs = { missingInB: [], extraInB: [], diverged: [] };
  let afterA = "";
  let afterB = "";
  let bufA = [];
  let bufB = [];
  let doneA = false;
  let doneB = false;

  const refill = async () => {
    if (!bufA.length && !doneA) {
      bufA = await hashChunk(A, t, afterA);
      if (bufA.length < CHUNK) doneA = true;
      if (bufA.length) afterA = bufA[bufA.length - 1].id;
    }
    if (!bufB.length && !doneB) {
      bufB = await hashChunk(B, t, afterB);
      if (bufB.length < CHUNK) doneB = true;
      if (bufB.length) afterB = bufB[bufB.length - 1].id;
    }
  };

  for (;;) {
    await refill();
    if (!bufA.length && !bufB.length) break;
    const a = bufA[0];
    const b = bufB[0];
    if (a && (!b || a.id < b.id)) {
      diffs.missingInB.push(a.id);
      bufA.shift();
    } else if (b && (!a || b.id < a.id)) {
      diffs.extraInB.push(b.id);
      bufB.shift();
    } else {
      if (a.h !== b.h) diffs.diverged.push(a.id);
      bufA.shift();
      bufB.shift();
    }
  }
  return diffs;
}

async function versions(node, t, ids) {
  if (!ids.length) return new Map();
  const rows = await node.db.$queryRawUnsafe(
    `SELECT row_id, updated_at, deleted_at FROM ha.row_versions
     WHERE schema_name = $1 AND table_name = $2 AND row_id = ANY($3::text[])`,
    t.schema,
    t.table,
    ids
  );
  return new Map(rows.map((r) => [r.row_id, r]));
}

async function fetchRow(node, t, id) {
  const rows = await node.db.$queryRawUnsafe(`SELECT to_jsonb(x) AS row FROM ${qualified(t)} x WHERE id = $1`, id);
  return rows[0]?.row || null;
}

const ts = (v) => (v ? new Date(v).getTime() : null);

// Decides, for one differing row, what to do. Returns { action, from, to } or null (leave alone).
function decide(kind, verA, verB) {
  const a = ts(verA?.updated_at);
  const b = ts(verB?.updated_at);
  const aDeleted = !!verA?.deleted_at;
  const bDeleted = !!verB?.deleted_at;

  if (kind === "missingInB") {
    // A has the row. B either never got it, or deleted it later (tombstone newer than A's version).
    if (bDeleted && b !== null && (a === null || b > a)) return { action: "delete", on: "A", version: verB };
    return { action: "copy", from: "A", to: "B", version: verA };
  }
  if (kind === "extraInB") {
    if (aDeleted && a !== null && (b === null || a >= b)) return { action: "delete", on: "B", version: verA };
    if (b !== null && (a === null || b > a)) return { action: "copy", from: "B", to: "A", version: verB };
    return { action: "delete", on: "B", version: verA }; // no evidence B's row is newer: A wins
  }
  // diverged
  if (b !== null && (a === null || b > a)) return { action: "copy", from: "B", to: "A", version: verB };
  return { action: "copy", from: "A", to: "B", version: verA };
}

async function runSyncCheck({ nodes: givenNodes, fix = true, tables, storage = true, trigger = "manual" } = {}) {
  const nodes = givenNodes || createNodes();
  const ownNodes = !givenNodes;
  const runId = crypto.randomUUID();
  const report = { runId, trigger, dryRun: !fix, startedAt: new Date().toISOString(), tables: [], storage: null, skipped: null, clean: true, totals: { differences: 0, fixed: 0, failedFixes: 0 } };
  const { A, B } = nodes;

  try {
    const [aUp, bUp] = await Promise.all([reachable(A), reachable(B)]);
    if (!aUp || !bUp) {
      report.skipped = { reason: "project unreachable", a: aUp ? "up" : "down", b: bUp ? "up" : "down" };
      report.clean = false;
      logger.warn("sync_check_skipped", report.skipped);
      return report;
    }

    const selected = SYNCED_TABLES.filter((t) => !tables || tables.includes(t.table));
    const deletes = []; // applied after all upserts, children first

    for (const t of selected) {
      const entry = { table: `${t.schema}.${t.table}` };
      try {
        const [sa, sb] = await Promise.all([tableStats(A, t), tableStats(B, t)]);
        entry.a = sa;
        entry.b = sb;
        const raw = await diffTable(A, B, t);
        const [busyA, busyB] = await Promise.all([inFlightIds(A, t), inFlightIds(B, t)]);
        const settled = (ids) => ids.filter((id) => !busyA.has(id) && !busyB.has(id));
        const diffs = { missingInB: settled(raw.missingInB), extraInB: settled(raw.extraInB), diverged: settled(raw.diverged) };
        entry.missingInB = diffs.missingInB.length;
        entry.extraInB = diffs.extraInB.length;
        entry.diverged = diffs.diverged.length;
        entry.inFlightSkipped = raw.missingInB.length + raw.extraInB.length + raw.diverged.length - (entry.missingInB + entry.extraInB + entry.diverged);
        entry.fixed = 0;
        entry.failedFixes = 0;
        const total = entry.missingInB + entry.extraInB + entry.diverged;
        report.totals.differences += total;
        if (total) report.clean = false;

        if (fix && total) {
          const ids = [...diffs.missingInB, ...diffs.extraInB, ...diffs.diverged];
          const [vA, vB] = await Promise.all([versions(A, t, ids), versions(B, t, ids)]);
          const isAudit = t.schema === "public" && t.table === "audit_logs";

          for (const [kind, list] of Object.entries(diffs)) {
            for (const id of list) {
              let plan = decide(kind, vA.get(id), vB.get(id));
              // A's audit chain is authoritative and append-only.
              if (isAudit) plan = kind === "extraInB" ? { action: "rechain" } : { action: "copy", from: "A", to: "B", version: vA.get(id) };
              if (plan.action === "delete") {
                deletes.push({ t, id, plan, kind });
                continue;
              }
              try {
                const from = nodes[plan.from || "B"];
                const row = await fetchRow(from, t, id);
                if (!row) continue; // vanished meanwhile
                if (plan.action === "rechain") {
                  await rechainAuditEntryOnA(A, row);
                } else {
                  const target = nodes[plan.to];
                  if (t.table === "capsule_files" && row.storagePath) await copyObject(from, target, row.storagePath);
                  const changedAt = plan.version?.updated_at || new Date();
                  await applyGeneric(target, { schema_name: t.schema, table_name: t.table, op: "UPDATE", row_id: id, payload: row, changed_at: changedAt, origin: from.name });
                }
                entry.fixed += 1;
                await recordSyncAudit(A, { source: "sync-check", runId, schemaName: t.schema, tableName: t.table, rowId: id, action: plan.action === "rechain" ? "rechain_on_A" : `copy_to_${plan.to}`, detail: { kind, trigger } });
              } catch (err) {
                entry.failedFixes += 1;
                logger.error("sync_check_fix_failed", { table: t.table, id, kind, message: err.message });
                await recordSyncAudit(A, { source: "sync-check", runId, schemaName: t.schema, tableName: t.table, rowId: id, action: "fix_failed", detail: { kind, error: err.message } });
              }
            }
          }
        }
      } catch (err) {
        entry.error = err.message;
        report.clean = false;
        logger.error("sync_check_table_failed", { table: t.table, message: err.message });
      }
      report.tables.push(entry);
    }

    // Deletes, children before parents.
    const order = new Map(selected.map((t, i) => [t.table, i]));
    deletes.sort((x, y) => order.get(y.t.table) - order.get(x.t.table));
    for (const d of deletes) {
      const entry = report.tables.find((e) => e.table === `${d.t.schema}.${d.t.table}`);
      try {
        const target = nodes[d.plan.on];
        await applyGeneric(target, { schema_name: d.t.schema, table_name: d.t.table, op: "DELETE", row_id: d.id, payload: { id: d.id }, changed_at: d.plan.version?.deleted_at || d.plan.version?.updated_at || new Date(), origin: d.plan.on === "A" ? "B" : "A" });
        entry.fixed += 1;
        await recordSyncAudit(A, { source: "sync-check", runId, schemaName: d.t.schema, tableName: d.t.table, rowId: d.id, action: `delete_on_${d.plan.on}`, detail: { kind: d.kind, trigger } });
      } catch (err) {
        entry.failedFixes += 1;
        logger.error("sync_check_fix_failed", { table: d.t.table, id: d.id, kind: d.kind, message: err.message });
      }
    }

    if (storage && process.env.SYNC_CHECK_STORAGE !== "false") report.storage = await checkStorage(nodes, { fix, runId, trigger });
    if (report.storage && (report.storage.missingInA || report.storage.missingInB)) report.clean = false;

    for (const e of report.tables) {
      report.totals.fixed += e.fixed || 0;
      report.totals.failedFixes += e.failedFixes || 0;
    }
    report.finishedAt = new Date().toISOString();
    await recordSyncAudit(A, { source: "sync-check", runId, action: "run_summary", detail: { trigger, dryRun: !fix, clean: report.clean, totals: report.totals, storage: report.storage } });
    logger.info("sync_check_done", { runId, trigger, dryRun: !fix, clean: report.clean, ...report.totals });
    return report;
  } finally {
    if (ownNodes) await disconnectNodes(nodes);
  }
}

// Storage objects follow capsule_files rows: each row's object must exist in both buckets.
// Orphan objects (no row on either side) are not listed: the bucket would need a full scan.
async function checkStorage(nodes, { fix, runId, trigger }) {
  const { A, B } = nodes;
  const result = { checked: 0, missingInA: 0, missingInB: 0, fixed: 0, errors: 0 };
  if (!A.supabase || !B.supabase) return { ...result, skipped: "storage client not configured" };

  let after = "";
  for (;;) {
    const rows = await A.db.$queryRawUnsafe(
      `SELECT id, "storagePath" FROM public.capsule_files WHERE id COLLATE "C" > $1 ORDER BY id COLLATE "C" LIMIT $2`,
      after,
      CHUNK
    );
    if (!rows.length) break;
    after = rows[rows.length - 1].id;
    for (const r of rows) {
      result.checked += 1;
      try {
        const [inA, inB] = await Promise.all([objectExists(A, r.storagePath), objectExists(B, r.storagePath)]);
        if (inA && inB) continue;
        if (!inA) result.missingInA += 1;
        if (!inB) result.missingInB += 1;
        if (!fix || (!inA && !inB)) continue;
        const [from, to] = inA ? [A, B] : [B, A];
        await copyObject(from, to, r.storagePath);
        result.fixed += 1;
        await recordSyncAudit(A, { source: "sync-check", runId, schemaName: "storage", tableName: "objects", rowId: r.storagePath, action: `storage_copy_to_${to.name}`, detail: { capsuleFileId: r.id, trigger } });
      } catch (err) {
        result.errors += 1;
        logger.warn("sync_check_storage_failed", { path: r.storagePath, message: err.message });
      }
    }
    if (rows.length < CHUNK) break;
  }
  return result;
}

module.exports = { runSyncCheck, decide };

if (require.main === module) {
  const args = process.argv.slice(2);
  const tableArg = args.find((a) => a.startsWith("--table="));
  runSyncCheck({
    fix: !args.includes("--dry-run"),
    storage: !args.includes("--no-storage"),
    tables: tableArg ? tableArg.slice("--table=".length).split(",") : undefined,
    trigger: "cli",
  })
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
      process.exit(report.skipped ? 3 : report.clean ? 0 : 2);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
