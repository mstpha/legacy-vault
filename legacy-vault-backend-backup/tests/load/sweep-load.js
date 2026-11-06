// Load test of the inactivity engine (monitoring.service) against a DISPOSABLE database.
//
//   node tests/load/sweep-load.js                 # 2 000 capsules (default)
//   CAPSULES=20000 npm run load:sweep             # 20 000 capsules
//   BASELINE=1 npm run load:sweep                 # also time the pre-Sprint-6 algorithm for comparison
//
// What it measures
//   1. ACTIVE -> INACTIVITY_ALERT   for N capsules whose testators are all overdue
//   2. INACTIVITY_ALERT -> PENDING_VALIDATION for the same N after their grace window expired
//   3. two sweeps running at the same time (two workers): every capsule must be handled exactly once
//   4. EXPLAIN ANALYZE of the "who is due?" query, to prove the indexes are used
// It prints a table and exits non-zero if a correctness check fails, so it can also run in CI.
const path = require("path");
const crypto = require("crypto");
require("dotenv").config({ path: path.join(__dirname, "../../.env.test") });

const url = process.env.TEST_DATABASE_URL;
if (!url || !/test/i.test(url)) {
  console.error('TEST_DATABASE_URL must be set and contain "test". Refusing to run: this script inserts thousands of rows.');
  process.exit(2);
}
process.env.DATABASE_URL = url;
process.env.DIRECT_URL = process.env.TEST_DIRECT_URL || url;
process.env.LOG_LEVEL = "error";
for (const k of ["SMTP_USER", "SMTP_PASS"]) delete process.env[k]; // no real emails

const prisma = require("../../src/config/db").getDb(); // backup: client of the active project (A unless failed over)
const { runInactivitySweep } = require("../../src/services/monitoring.service");
const { createNotification } = require("../../src/services/notification.service");
const { writeAuditLog } = require("../../src/services/audit.service");

const N = Number(process.env.CAPSULES || 2000);
const GUARANTORS_PER_CAPSULE = 2;
const TAG = `load-${crypto.randomBytes(3).toString("hex")}`;
const DAY = 24 * 60 * 60 * 1000;
const chunk = (arr, size) => Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, (i + 1) * size));
const fmt = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms.toFixed(0)} ms`);
const rows = [];
let peakRss = 0;
const sampler = setInterval(() => (peakRss = Math.max(peakRss, process.memoryUsage().rss)), 100);
let failed = false;
const check = (ok, msg) => {
  if (!ok) failed = true;
  console.log(`${ok ? "  ok " : "  FAIL"}  ${msg}`);
};

async function seed(label, count) {
  const old = new Date(Date.now() - 100 * DAY);
  const users = Array.from({ length: count }, () => ({
    id: crypto.randomUUID(),
    email: `${TAG}-${label}-${crypto.randomUUID()}@load.test`,
    passwordHash: "x",
    fullName: "Load testator",
    emailVerified: true,
    lastSeenAt: old,
  }));
  const guarantorUsers = Array.from({ length: Math.min(200, count) }, () => ({
    id: crypto.randomUUID(),
    email: `${TAG}-${label}-g-${crypto.randomUUID()}@load.test`,
    passwordHash: "x",
    fullName: "Load guarantor",
    emailVerified: true,
  }));
  const capsules = users.map((u) => ({
    id: crypto.randomUUID(),
    testatorId: u.id,
    title: "load",
    type: "MESSAGE",
    state: "ACTIVE",
    inactivityThresholdDays: 30,
    graceWindowDays: 7,
    validationThreshold: 2,
  }));
  const guarantors = capsules.flatMap((c, i) =>
    Array.from({ length: GUARANTORS_PER_CAPSULE }, (_, k) => ({
      id: crypto.randomUUID(),
      capsuleId: c.id,
      userId: guarantorUsers[(i + k) % guarantorUsers.length].id,
    }))
  );
  for (const part of chunk([...users, ...guarantorUsers], 2000)) await prisma.user.createMany({ data: part });
  for (const part of chunk(capsules, 2000)) await prisma.capsule.createMany({ data: part });
  for (const part of chunk(guarantors, 2000)) await prisma.capsuleGuarantor.createMany({ data: part });
  return { ids: capsules.map((c) => c.id), userIds: [...users, ...guarantorUsers].map((u) => u.id) };
}

async function timed(name, fn) {
  const t0 = process.hrtime.bigint();
  const result = await fn();
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return { name, ms, result };
}

// The algorithm as it was before Sprint 6, kept only to quantify the improvement.
async function legacySweep(ids) {
  const active = await prisma.capsule.findMany({ where: { id: { in: ids }, state: "ACTIVE" }, include: { testator: true } });
  for (const c of active) {
    const last = c.testator.lastSeenAt || c.createdAt;
    if (Date.now() - last.getTime() < c.inactivityThresholdDays * DAY) continue;
    const grace = new Date(Date.now() + c.graceWindowDays * DAY);
    await prisma.capsule.update({ where: { id: c.id }, data: { state: "INACTIVITY_ALERT", alertSentAt: new Date(), graceWindowExpiresAt: grace } });
    await createNotification(c.testatorId, "INACTIVITY_ALERT", { capsuleId: c.id, graceWindowExpiresAt: grace });
    await writeAuditLog({ capsuleId: c.id, action: "INACTIVITY_ALERT_TRIGGERED" });
  }
  return active.length;
}

async function cleanup() {
  const users = await prisma.user.findMany({ where: { email: { startsWith: TAG } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  for (const part of chunk(ids, 5000)) {
    await prisma.notification.deleteMany({ where: { userId: { in: part } } });
    await prisma.capsuleGuarantor.deleteMany({ where: { userId: { in: part } } });
    await prisma.capsule.deleteMany({ where: { testatorId: { in: part } } });
    await prisma.user.deleteMany({ where: { id: { in: part } } });
  }
}

(async () => {
  console.log(`Load test: ${N} capsules, ${GUARANTORS_PER_CAPSULE} guarantors each (tag ${TAG})\n`);
  try {
    console.log("Seeding...");
    const set = await seed("a", N);

    // 1. alerts
    const alert = await timed("ACTIVE -> INACTIVITY_ALERT", () => runInactivitySweep());
    rows.push([alert.name, N, alert.ms]);
    const alerted = await prisma.capsule.count({ where: { id: { in: set.ids }, state: "INACTIVITY_ALERT" } });
    check(alerted === N, `${alerted}/${N} capsules moved to INACTIVITY_ALERT`);
    const alertNotifs = await prisma.notification.count({ where: { type: "INACTIVITY_ALERT", user: { email: { startsWith: TAG } } } });
    check(alertNotifs === N, `${alertNotifs}/${N} testator notifications created (exactly one each)`);

    // 2. escalation
    for (const part of chunk(set.ids, 5000)) {
      await prisma.capsule.updateMany({ where: { id: { in: part } }, data: { graceWindowExpiresAt: new Date(Date.now() - 60000) } });
    }
    const escalate = await timed("INACTIVITY_ALERT -> PENDING_VALIDATION", () => runInactivitySweep());
    rows.push([escalate.name, N, escalate.ms]);
    const pending = await prisma.capsule.count({ where: { id: { in: set.ids }, state: "PENDING_VALIDATION" } });
    check(pending === N, `${pending}/${N} capsules moved to PENDING_VALIDATION`);
    const reqs = await prisma.notification.count({ where: { type: "VALIDATION_REQUEST", user: { email: { startsWith: TAG } } } });
    check(reqs === N * GUARANTORS_PER_CAPSULE, `${reqs}/${N * GUARANTORS_PER_CAPSULE} guarantor notifications created`);

    // 3. idempotence: a third sweep finds nothing to do
    const idle = await timed("idle sweep (nothing due)", () => runInactivitySweep());
    rows.push([idle.name, 0, idle.ms]);
    check(idle.result.alertsSent === 0 && idle.result.escalatedToValidation === 0, "a sweep with nothing due changes nothing");

    // 4. two concurrent workers on fresh data: each capsule exactly once
    const second = await seed("b", Math.min(N, 1000));
    const [w1, w2] = await Promise.all([runInactivitySweep(), runInactivitySweep()]);
    const handled = w1.alertsSent + w2.alertsSent;
    check(handled === second.ids.length, `two concurrent sweeps handled ${handled}/${second.ids.length} capsules (no double alert, none skipped)`);
    const dup = await prisma.$queryRaw`
      SELECT count(*)::int AS n FROM (
        SELECT payload->>'capsuleId' AS cid FROM notifications
        WHERE type = 'INACTIVITY_ALERT' AND payload->>'capsuleId' = ANY(${second.ids})
        GROUP BY 1 HAVING count(*) > 1) d`;
    check(dup[0].n === 0, "no capsule received two INACTIVITY_ALERT notifications");
    rows.push([`2 concurrent sweeps (${second.ids.length} capsules)`, second.ids.length, 0]);

    // 5. optional baseline
    if (process.env.BASELINE) {
      const third = await seed("c", Math.min(N, 2000));
      const base = await timed("BASELINE pre-Sprint-6 alert pass", () => legacySweep(third.ids));
      rows.push([base.name, third.ids.length, base.ms]);
    }

    // 6. query plan of the due-capsule scan
    const plan = await prisma.$queryRawUnsafe(`
      EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
      SELECT c.id FROM capsules c JOIN users u ON u.id = c."testatorId"
      WHERE c.state = 'ACTIVE'::"CapsuleState"
        AND COALESCE(u."lastSeenAt", c."createdAt") <= (now() AT TIME ZONE 'UTC') - (c."inactivityThresholdDays" * interval '1 day')
      LIMIT 500`);
    console.log("\nQuery plan, phase 1 (is an index used? look for 'Index Scan' / 'Bitmap Index Scan'):");
    for (const p of plan) console.log("  " + p["QUERY PLAN"]);
  } finally {
    clearInterval(sampler);
    console.log("\nCleaning up...");
    await cleanup().catch((e) => console.error("cleanup failed:", e.message));
    await prisma.$disconnect();
  }

  console.log("\n  scenario".padEnd(52) + "capsules".padStart(9) + "time".padStart(12) + "capsules/s".padStart(13));
  for (const [name, n, ms] of rows) {
    console.log(`  ${name}`.padEnd(50) + String(n).padStart(9) + (ms ? fmt(ms) : "-").padStart(12) + (ms && n ? Math.round(n / (ms / 1000)).toString() : "-").padStart(13));
  }
  console.log(`\n  peak RSS: ${(peakRss / 1024 / 1024).toFixed(0)} MB`);
  process.exit(failed ? 1 : 0);
})();
