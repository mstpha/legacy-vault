# Backend test suite

The default test command is offline and does not connect to PostgreSQL, Redis,
email, or external storage:

```powershell
npm test
npm run test:report
npm run test:unit
npm run test:api
npm run test:security
```

Unit coverage includes credential hashing, token verification, request schemas,
audit-chain integrity, notification/schema/migration consistency, error
redaction, and idempotency behavior. API tests exercise Helmet headers,
authentication gates, payload validation and limits, and rate-limit isolation.

## Performance tests

Both load scripts are opt-in. Use only a disposable database and a dedicated
test account. They require explicit confirmation (`ALLOW_HTTP_LOAD=YES` or
`ALLOW_SWEEP_TESTS=YES`) as well as a `TEST_DATABASE_URL` whose database name
contains `test` or whose query contains the exact marker
`application_name=legacy_vault_test`. Use a separate, disposable Supabase
project; a URL marker does not make a development or production database safe.
Copy `.env.test.example` to `.env.test` and use the test project's pooler URL
with that application name appended.

HTTP load test (PowerShell):

```powershell
$env:TEST_DATABASE_URL = 'postgresql://...pooler.supabase.com:6543/postgres?pgbouncer=true&application_name=legacy_vault_test'
$env:PERF_TEST_EMAIL = 'load-test@example.test'
$env:PERF_TEST_PASSWORD = '<test-account-password>'
$env:ALLOW_HTTP_LOAD = 'YES'
$env:BASE_URL = 'http://localhost:4000'
npm run load:http
```

The API must already be running against that same disposable database. Configure
`CONNECTIONS`, `DURATION`, and `MAX_P99_MS` to adjust the bounded load and
latency acceptance threshold.

After applying Prisma migrations, open `tests/sql/seed-http-load-test.sql` in
pgAdmin's Query Tool. Edit the example email and test-only password near the
top, confirm pgAdmin is connected to the disposable `*_test` database, and run
the whole script. It seeds the role-permission matrix and stores only a bcrypt
hash:

The SQL script refuses databases whose name does not contain `test`. Set the
same email and password in `PERF_TEST_EMAIL` and `PERF_TEST_PASSWORD` when
running `load:http`. Use a disposable test-only password; do not reuse a
personal or production password.

Inactivity sweep benchmark (inserts and removes test rows):

```powershell
$env:TEST_DATABASE_URL = 'postgresql://...pooler.supabase.com:6543/postgres?pgbouncer=true&application_name=legacy_vault_test'
$env:ALLOW_SWEEP_TESTS = 'YES'
npm run load:sweep
```

`CAPSULES` selects the benchmark size; `BASELINE=1` also measures the older
per-capsule algorithm. The script reports state-transition correctness, sweep
time, memory, and the query plan.
