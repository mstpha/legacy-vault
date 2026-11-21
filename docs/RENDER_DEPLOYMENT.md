# Render free demo: primary and backup APIs

The root [render.yaml](../render.yaml) defines the primary API, backup API,
an embedded sync worker in the backup service, and shared Render Key Value
(Redis). It does not create or use Render PostgreSQL databases: PostgreSQL and
file storage both remain on Supabase.
This Blueprint is configured for a **free demo**, not dependable production
availability.

## Before deploying

1. Create or keep **two Supabase projects**, A and B. A is the primary
   PostgreSQL database and B is the standby; both projects also provide the
   Supabase Storage buckets used by the app and sync logic. Keep the projects
   in the same region when possible.
2. The two Render APIs and Key Value are on free plans. Free web services sleep
    after 15 minutes without inbound traffic and may take about a minute to
    wake. Free Key Value can lose its data when restarted. The sync worker runs
    inside the backup service rather than as a separate Render worker.
3. Create the private `capsule-files` bucket in both Supabase projects. The
    service-role keys are server-side only; never put them in the mobile app.
4. The Blueprint creates one free Render Key Value service for Redis, shared
    by both API services. Its queue data is not durable.
5. Push this repository, including `render.yaml`, to the Git branch you will
   deploy from. In Render, choose **New → Blueprint**, select that repository
   and branch, and apply the Blueprint. The Blueprint currently places Render
    services in Frankfurt; change their `region` in `render.yaml` if another
    available Render region is closer to your Supabase projects.

## Render environment values

Enter secrets in the Render Dashboard under each service's **Environment**
page. Blueprint `sync: false` entries are intentionally blank and must not be
committed with credentials.

Set these Supabase database connection strings in Render. For runtime, use
each project's **Transaction pooler** URL (usually port `6543`, with
`pgbouncer=true` and a small `connection_limit`). For migrations, use the
project's **Direct connection** URL, or its **Session pooler** URL if direct
connections are unavailable from Render. Do not use a transaction-pooler URL
for migrations.

| Render service | Variables |
| --- | --- |
| `legacy-vault-backend` | `DATABASE_URL` = A's transaction-pooler URL |
| `legacy-vault-backend-backup` | `DATABASE_URL` = A's transaction-pooler URL; `DIRECT_URL` = A's direct/session-pooler URL; `B_DATABASE_URL` = B's transaction-pooler URL; `B_DIRECT_URL` = B's direct/session-pooler URL |

The backup service's startup initializer uses `DIRECT_URL` and `B_DIRECT_URL`
for migrations and HA SQL setup. Since free services don't support a
pre-deploy command, this initializer runs whenever the backup service starts.
The APIs use the pooled URLs.

Set these Supabase values on the indicated services:

| Render service | Variables |
| --- | --- |
| Primary | `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` for Storage project A |
| Backup | `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` for A, plus `B_SUPABASE_URL` and `B_SUPABASE_SERVICE_ROLE_KEY` for B |

The Blueprint automatically sets `REDIS_URL` on both API services to the
internal connection string for `legacy-vault-redis`. Generate two distinct
random JWT secrets and set the same `JWT_ACCESS_SECRET` and
`JWT_REFRESH_SECRET` on both web services. Do not send secret values in chat
or commit them to the repository.

Generate each JWT secret locally (run the command twice) and paste the results
directly into both Render web services:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Optional mail and monitoring values (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
`SMTP_PASS`, `MAIL_FROM_EMAIL`, `SENTRY_DSN`) can be added later. Configure
them on the primary and backup alike if the app sends email or reports errors.

## What the Blueprint does

- Builds each Node service from its own package lockfile and generates Prisma
  Client.
- Starts the primary API and backup API as separate Render web services.
- Runs the backup startup initializer. It applies the checked-in Prisma
  migrations to Supabase A and B, installs the HA schema on each database,
  assigns the node identities, and installs the B-only audit-chain rule.
- Starts the sync worker as a child process inside the backup web service.
  Worker output appears in the backup service's Render logs.
- Uses `/health/live` as Render's process-level health check. This endpoint
  intentionally stays available when a database is down; use the public
  `/health` endpoint to monitor database/failover status.

The primary remains the normal app URL. The backup web service has its own
public URL. Both can sleep on the free plan.

## First deployment and verification

1. Wait for the backup service to start successfully. Its logs should show the
   database migrations and HA trigger setup completing. If Prisma fails,
   verify the A/B Supabase URLs, direct/session-pooler connectivity, and that A
   and B are distinct projects.
2. If A already has application rows, run a one-time sync-check after both
   Storage buckets exist. Free Render services don't provide Shell access, so
   run `npm run sync:check` locally from `legacy-vault-backend-backup` with
   that folder's `.env` configured for both Supabase projects. For brand-new
   empty databases, this is not needed.
3. Check `https://<primary-service>.onrender.com/health` and
   `https://<backup-service>.onrender.com/health`. Both should report a healthy
   database when Supabase A is reachable. A healthy response does not mean B
   is synchronized in this free demo.
4. Confirm the backup logs contain `sync_worker_started`. While the backup
   service is awake, the worker copies changes between A and B. **Demo
   limitation:** when Render sleeps or restarts the backup service, syncing
   pauses, so B can be stale. If A fails, the backup may switch to stale B.
   Do not use this deployment for real vault data or treat it as reliable
   database failover.
5. In `legacy-vault-app/.env`, set `EXPO_PUBLIC_PRIMARY_API_URL` and
   `EXPO_PUBLIC_BACKUP_API_URL` to the two Render web-service URLs with `/api`
   appended (for example, `https://primary.onrender.com/api`).

## Values to send me after creating the databases

Send the following **non-secret** details so I can tailor/verify the setup:

- Whether you have two Supabase projects (A and B), and their regions.
- Whether A is new/empty or already contains records that must be copied.
- The names/URLs Render assigned to the primary and backup web services, once
  created, if you want the mobile app config updated too.
- Whether both Supabase projects have the private `capsule-files` bucket.
- Any Render pre-deploy/build error text (redact connection strings, passwords,
  keys, and tokens).

Do **not** send database URLs containing passwords, Supabase service-role keys,
Redis credentials, SMTP passwords, or JWT secrets here. Enter those directly
in Render's Environment dashboard. If you already created Render Postgres
databases, they are not used by this setup.

## Free-plan limitations

Render free web services sleep after 15 minutes idle, cold starts take time,
and the free Redis-compatible service is not durable. The sync worker is a
child of the backup service, so it sleeps and restarts with that service;
replication is best-effort and B can be stale. Render also applies monthly
free-instance-hour and usage limits. This is for testing only; use a paid
always-on worker and persistent Redis before storing real vault data.
