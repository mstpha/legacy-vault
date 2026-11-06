-- Sprint 6: indexes for the queries the monitoring engine and the capsule/notification screens run.
-- (The tables are small enough at this stage that a plain CREATE INDEX inside the migration
--  transaction is fine; use CREATE INDEX CONCURRENTLY by hand on a large production table.)

-- Sweep phase 1 (ACTIVE capsules joined to their testator's lastSeenAt)
CREATE INDEX IF NOT EXISTS "users_lastSeenAt_idx" ON "users"("lastSeenAt");

-- Sweep phase 2 (state = INACTIVITY_ALERT AND graceWindowExpiresAt <= now). state is the leading
-- column, so this replaces the old single-column state index.
DROP INDEX IF EXISTS "capsules_state_idx";
CREATE INDEX IF NOT EXISTS "capsules_state_graceWindowExpiresAt_idx" ON "capsules"("state", "graceWindowExpiresAt");

-- "Capsules I guarantee / benefit from": the existing unique indexes lead with capsuleId, so
-- lookups by userId alone were sequential scans.
CREATE INDEX IF NOT EXISTS "capsule_guarantors_userId_idx" ON "capsule_guarantors"("userId");
CREATE INDEX IF NOT EXISTS "capsule_beneficiaries_userId_idx" ON "capsule_beneficiaries"("userId");
CREATE INDEX IF NOT EXISTS "capsule_key_shares_userId_idx" ON "capsule_key_shares"("userId");

-- Notification inbox: WHERE userId ORDER BY createdAt DESC LIMIT 50 (replaces the userId-only index).
DROP INDEX IF EXISTS "notifications_userId_idx";
CREATE INDEX IF NOT EXISTS "notifications_userId_createdAt_idx" ON "notifications"("userId", "createdAt");

-- Refresh-token housekeeping (DELETE WHERE expiresAt < cutoff).
CREATE INDEX IF NOT EXISTS "refresh_tokens_expiresAt_idx" ON "refresh_tokens"("expiresAt");
