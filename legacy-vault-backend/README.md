# Digital Legacy Vault — Backend (Sprint 1: Foundations & Authentication)

This covers every Sprint 1 bullet from the backlog:
- Project setup (Node.js/Express backend, ready for the React Native front)
- Registration + login with secure password hashing (bcrypt, 12 rounds)
- TOTP-based MFA (enrollment + login verification)
- Sessions via short-lived JWT access tokens + rotating, DB-backed refresh tokens (`RefreshToken` entity)
- Full data model on Supabase/Postgres (User, Capsule, CapsuleGuarantor, CapsuleBeneficiary, Validation, AuditLog, Notification, RefreshToken)
- Winston logging + Sentry error tracking wired in from the start

## 1. Prerequisites

- Node.js 20+
- A free [Supabase](https://supabase.com) project
- (Optional this sprint, needed from Sprint 3) Redis — `redis-server` locally or a free Upstash instance

## 2. Create the Supabase project

1. Go to supabase.com → New project. Pick a name, region, and a strong database password (save it).
2. Once created, go to **Project Settings → Database**.
3. Copy the **Connection string → Transaction pooler** (port 6543) — this is your `DATABASE_URL`.
4. Copy the **Connection string → Session/direct** (port 5432) — this is your `DIRECT_URL`. Prisma needs the direct one for running migrations.
5. Go to **Project Settings → API** and copy `Project URL`, `anon public` key, and `service_role` key (you won't use these yet in Sprint 1, but Sprint 2 needs them for Storage/RLS).

## 3. Install dependencies

```bash
cd legacy-vault-backend
npm install
```

## 4. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` and fill in:
- `DATABASE_URL`, `DIRECT_URL` — from step 2
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — from step 2
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` — generate two strong random values, e.g.:
  ```bash
  node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
  ```
  (run it twice, once per secret)
- Leave `SENTRY_DSN` empty for now if you don't have a Sentry project yet — the app runs fine without it, it just logs a warning and skips error tracking.

## 5. Create the database schema

This pushes the full `prisma/schema.prisma` model (all 8 entities) to your Supabase Postgres instance:

```bash
npm run prisma:migrate
```

This will prompt for a migration name — anything like `init` is fine. It creates the tables and generates the Prisma client.

You can visually confirm the tables were created:

```bash
npm run prisma:studio
```

(opens a local GUI at http://localhost:5555, or check the **Table Editor** in the Supabase dashboard)

## 6. Run the API

```bash
npm run dev
```

You should see:
```
<timestamp> [info] Legacy Vault API listening on port 4000 (development)
```

Check it's alive:
```bash
curl http://localhost:4000/health
# {"status":"ok","uptime":...}
```

## 7. Try the auth flow end-to-end

**Register:**
```bash
curl -X POST http://localhost:4000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"amine@example.com","password":"SuperSecret123!","fullName":"Amine Trabelsi"}'
```

**Login (no MFA yet):**
```bash
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"amine@example.com","password":"SuperSecret123!"}'
```
→ returns `{ user, accessToken, refreshToken }`

**Enroll in MFA** (use the `accessToken` from login):
```bash
curl -X POST http://localhost:4000/api/auth/mfa/setup \
  -H "Authorization: Bearer <accessToken>"
```
→ returns `{ secret, qrCodeDataUrl }`. Paste the `qrCodeDataUrl` (a `data:image/png;base64,...` string) into a browser address bar to see the QR code, or add `secret` manually in Google Authenticator / Authy.

**Confirm MFA** with the 6-digit code the authenticator app now shows:
```bash
curl -X POST http://localhost:4000/api/auth/mfa/confirm \
  -H "Authorization: Bearer <accessToken>" \
  -H "Content-Type: application/json" \
  -d '{"token":"123456"}'
```

**Login now requires the code:**
```bash
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"amine@example.com","password":"SuperSecret123!"}'
# -> {"mfaRequired":true}

curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"amine@example.com","password":"SuperSecret123!","mfaToken":"123456"}'
# -> {"user":..., "accessToken":..., "refreshToken":...}
```

**Refresh a session** (rotates the refresh token — the old one stops working):
```bash
curl -X POST http://localhost:4000/api/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken":"<refreshToken>"}'
```

**Logout** (revokes the refresh token):
```bash
curl -X POST http://localhost:4000/api/auth/logout \
  -H "Authorization: Bearer <accessToken>" \
  -H "Content-Type: application/json" \
  -d '{"refreshToken":"<refreshToken>"}'
```

## 8. Run the tests

Point `DATABASE_URL`/`DIRECT_URL` at a disposable test database (a second free Supabase project works well), migrate it, then:

```bash
npm test
```

## 9. Wire up Sentry (optional but recommended before Sprint 2)

1. Create a free project at sentry.io (Node/Express platform).
2. Copy its DSN into `SENTRY_DSN` in `.env`.
3. Restart the server. Trigger a test error (e.g. hit `/api/auth/login` with a malformed body enough times, or temporarily throw in a route) and confirm it shows up in the Sentry dashboard.

## What's deliberately *not* built yet

- Capsule CRUD, encryption, Supabase Storage, RLS policies → Sprint 2
- BullMQ/Redis inactivity scheduler → Sprint 3
- Guarantor portal & validation voting → Sprint 4
- Beneficiary read access, audit hash-chaining, full RBAC/RLS → Sprint 5
- Load tests, `/health` deep checks, security audit → Sprint 6

The `Capsule`, `CapsuleGuarantor`, `CapsuleBeneficiary`, `Validation`, `AuditLog`, and `Notification` tables already exist in the DB per the Sprint 1 "complete modeling" requirement, but no routes touch them yet — that starts in Sprint 2.

## Project structure

```
legacy-vault-backend/
├── prisma/
│   └── schema.prisma          # all 8 entities, RM10 state enum
├── src/
│   ├── config/
│   │   ├── db.js              # Prisma client singleton
│   │   ├── logger.js          # Winston
│   │   └── sentry.js          # Sentry init
│   ├── controllers/
│   │   └── auth.controller.js
│   ├── middleware/
│   │   ├── errorHandler.js
│   │   ├── rateLimiter.js
│   │   └── requireAuth.js
│   ├── routes/
│   │   └── auth.routes.js
│   ├── services/
│   │   ├── auth.service.js
│   │   ├── mfa.service.js     # TOTP via otplib
│   │   └── token.service.js   # JWT + refresh token rotation
│   ├── utils/
│   │   ├── password.js        # bcrypt + token hashing
│   │   └── validators.js      # zod schemas
│   ├── app.js
│   └── server.js
├── tests/
│   └── auth.test.js
├── .env.example
└── package.json
```
