// HTTP load test with autocannon against a RUNNING API (start it on the same disposable database):
//
//   DATABASE_URL="$TEST_DATABASE_URL" npm start          # terminal 1
//   BASE_URL=http://localhost:4000 npm run load:http      # terminal 2
//
// Hits /health, /health/ready and an authenticated list endpoint, and fails if the error rate or p99 is too high.
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcrypt");
require("dotenv").config({ path: path.join(__dirname, "../../.env.test") });

const url = process.env.TEST_DATABASE_URL;
if (!url || !/test/i.test(url)) {
  console.error('TEST_DATABASE_URL must be set and contain "test".');
  process.exit(2);
}
process.env.DATABASE_URL = url;
process.env.DIRECT_URL = process.env.TEST_DIRECT_URL || url;
process.env.LOG_LEVEL = "error";

const autocannon = require("autocannon");
const prisma = require("../../src/config/db").getDb(); // backup: client of the active project (A unless failed over)

const BASE_URL = process.env.BASE_URL || "http://localhost:4000";
const CONNECTIONS = Number(process.env.CONNECTIONS || 50);
const DURATION = Number(process.env.DURATION || 15);
const MAX_P99_MS = Number(process.env.MAX_P99_MS || 1000);

const run = (opts) => new Promise((resolve, reject) => autocannon({ url: BASE_URL, connections: CONNECTIONS, duration: DURATION, ...opts }, (e, r) => (e ? reject(e) : resolve(r))));

(async () => {
  const email = `load-http-${crypto.randomBytes(3).toString("hex")}@load.test`;
  const password = "LoadTest123!";
  const user = await prisma.user.create({
    data: { email, passwordHash: await bcrypt.hash(password, 4), fullName: "Load http", emailVerified: true },
  });
  let failed = false;
  try {
    const login = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!login.ok) throw new Error(`login failed (${login.status}); is the API running on the same database?`);
    const { accessToken } = await login.json();

    const targets = [
      ["GET /health", { requests: [{ method: "GET", path: "/health" }] }],
      ["GET /health/ready", { requests: [{ method: "GET", path: "/health/ready" }], connections: Math.min(CONNECTIONS, 10) }],
      ["GET /api/capsules (authenticated)", { requests: [{ method: "GET", path: "/api/capsules", headers: { authorization: `Bearer ${accessToken}` } }] }],
    ];
    console.log(`${CONNECTIONS} connections, ${DURATION}s per target, ${BASE_URL}\n`);
    console.log("target".padEnd(36) + "req/s".padStart(9) + "p50".padStart(8) + "p99".padStart(8) + "non-2xx".padStart(9) + "errors".padStart(8));
    for (const [name, opts] of targets) {
      const r = await run(opts);
      const bad = r.non2xx + r.errors + r.timeouts;
      if (bad > 0 || r.latency.p99 > MAX_P99_MS) failed = true;
      console.log(
        name.padEnd(36) + String(Math.round(r.requests.average)).padStart(9) + `${r.latency.p50}ms`.padStart(8) + `${r.latency.p99}ms`.padStart(8) + String(r.non2xx).padStart(9) + String(r.errors + r.timeouts).padStart(8)
      );
    }
  } finally {
    await prisma.refreshToken.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  }
  console.log(failed ? `\nFAILED (errors, or p99 > ${MAX_P99_MS} ms)` : "\nPASSED");
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
