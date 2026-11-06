-- Sprint 6 repair: this file used to contain the PowerShell command that was meant to CREATE it
-- (@' ... '@ | Set-Content ...), which is not SQL, so `prisma migrate deploy` failed on any fresh database.
--
-- Existing accounts predate email verification, so they are treated as verified. New accounts are created
-- with emailVerified = false explicitly by auth.service#register, and the column default matches
-- schema.prisma (false) so the database and Prisma stay in sync.
ALTER TABLE "users"
    ADD COLUMN IF NOT EXISTS "emailVerified" BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS "emailVerificationCodeHash" TEXT,
    ADD COLUMN IF NOT EXISTS "emailVerificationExpiresAt" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "emailVerificationAttempts" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "users" ALTER COLUMN "emailVerified" SET DEFAULT false;
