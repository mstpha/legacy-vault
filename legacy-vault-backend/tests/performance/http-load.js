// Run against an API started with the disposable test database:
//   $env:TEST_DATABASE_URL='postgresql://...pooler.supabase.com:6543/postgres?pgbouncer=true&application_name=legacy_vault_test'
//   $env:PERF_TEST_EMAIL='load-test@example.test'
//   $env:PERF_TEST_PASSWORD='...'
//   $env:ALLOW_HTTP_LOAD='YES'
//   npm run load:http
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../../.env.test") });
const { isDisposableTestDatabase } = require("../helpers/testDatabase");

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!isDisposableTestDatabase(testDatabaseUrl)) {
  console.error(
    "TEST_DATABASE_URL must name a test database or include application_name=legacy_vault_test. Refusing to run."
  );
  process.exit(2);
}
if (process.env.ALLOW_HTTP_LOAD !== "YES") {
  console.error("Refusing to run load traffic without ALLOW_HTTP_LOAD=YES.");
  process.exit(2);
}
if (!process.env.PERF_TEST_EMAIL || !process.env.PERF_TEST_PASSWORD) {
  console.error("Set PERF_TEST_EMAIL and PERF_TEST_PASSWORD to a dedicated test account.");
  process.exit(2);
}

const autocannon = require("autocannon");
const BASE_URL = (process.env.BASE_URL || "http://localhost:4000").replace(/\/+$/, "");
const CONNECTIONS = Number(process.env.CONNECTIONS || 25);
const DURATION = Number(process.env.DURATION || 10);
const MAX_P99_MS = Number(process.env.MAX_P99_MS || 1000);

if (
  !Number.isInteger(CONNECTIONS) ||
  CONNECTIONS < 1 ||
  CONNECTIONS > 250 ||
  !Number.isInteger(DURATION) ||
  DURATION < 1 ||
  DURATION > 120 ||
  !Number.isFinite(MAX_P99_MS) ||
  MAX_P99_MS <= 0
) {
  console.error("Invalid load settings (connections 1-250, duration 1-120 seconds, positive MAX_P99_MS).");
  process.exit(2);
}

const run = (options) =>
  new Promise((resolve, reject) =>
    autocannon(
      { url: BASE_URL, connections: CONNECTIONS, duration: DURATION, ...options },
      (error, result) => (error ? reject(error) : resolve(result))
    )
  );

async function main() {
  const live = await fetch(`${BASE_URL}/health/live`);
  if (!live.ok) throw new Error(`Liveness check failed (${live.status}); verify BASE_URL.`);

  const login = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: process.env.PERF_TEST_EMAIL,
      password: process.env.PERF_TEST_PASSWORD,
    }),
  });
  if (!login.ok) throw new Error(`Test account login failed (${login.status}).`);
  const { accessToken } = await login.json();
  if (!accessToken) throw new Error("Login response did not contain an access token.");

  const targets = [
    ["GET /health/live", { requests: [{ method: "GET", path: "/health/live" }] }],
    ["GET /health/ready", { requests: [{ method: "GET", path: "/health/ready" }], connections: Math.min(CONNECTIONS, 10) }],
    [
      "GET /api/capsules (authenticated)",
      {
        requests: [
          {
            method: "GET",
            path: "/api/capsules",
            headers: { authorization: `Bearer ${accessToken}` },
          },
        ],
      },
    ],
  ];

  let failed = false;
  console.log(`HTTP load: ${CONNECTIONS} connections, ${DURATION}s per target, ${BASE_URL}`);
  console.log("target".padEnd(38) + "req/s".padStart(9) + "p50".padStart(9) + "p99".padStart(9) + "non-2xx".padStart(10) + "errors".padStart(9));
  for (const [name, options] of targets) {
    const result = await run(options);
    const errors = result.errors + result.timeouts;
    const badResponses = result.non2xx;
    if (badResponses > 0 || errors > 0 || result.latency.p99 > MAX_P99_MS) failed = true;
    console.log(
      name.padEnd(38) +
        String(Math.round(result.requests.average)).padStart(9) +
        `${result.latency.p50}ms`.padStart(9) +
        `${result.latency.p99}ms`.padStart(9) +
        String(badResponses).padStart(10) +
        String(errors).padStart(9)
    );
  }

  console.log(failed ? `FAILED (errors or p99 > ${MAX_P99_MS} ms)` : "PASSED");
  process.exitCode = failed ? 1 : 0;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
