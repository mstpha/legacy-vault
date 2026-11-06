// Runs BEFORE any module is loaded in each e2e test file (jest `setupFiles`).
// Points Prisma at the disposable test database and relaxes limits that exist to stop abuse.
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../../.env.test") });

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) {
  throw new Error(
    "TEST_DATABASE_URL is not set. Copy .env.test.example to .env.test and point it at a disposable database."
  );
}
// Safety net: these tests create and delete data. Never let them run against the dev/prod database.
if (!/test/i.test(testUrl)) {
  throw new Error('Refusing to run e2e tests: TEST_DATABASE_URL must contain "test" in its name.');
}

process.env.DATABASE_URL = testUrl;
process.env.DIRECT_URL = process.env.TEST_DIRECT_URL || testUrl;

process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = process.env.LOG_LEVEL_TEST || "error";
process.env.SENTRY_DSN = "";
process.env.JWT_ACCESS_SECRET = "e2e-access-secret-0123456789abcdef0123456789abcdef";
process.env.JWT_REFRESH_SECRET = "e2e-refresh-secret-0123456789abcdef0123456789abcdef";
process.env.JWT_ACCESS_EXPIRES_IN = "1h";

// Abuse limiters are exercised explicitly in their own tests; everything else must not trip them.
process.env.AUTH_RATE_MAX = "1000";
process.env.REFRESH_RATE_MAX = "1000";
// Keep lastSeenAt stable while a test fiddles with it (see requireAuth).
process.env.LAST_SEEN_TOUCH_INTERVAL_MS = String(60 * 60 * 1000);
