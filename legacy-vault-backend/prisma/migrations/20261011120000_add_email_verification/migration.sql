@'
ALTER TABLE "users"
    ADD COLUMN IF NOT EXISTS "emailVerified" BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS "emailVerificationCodeHash" TEXT,
    ADD COLUMN IF NOT EXISTS "emailVerificationExpiresAt" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "emailVerificationAttempts" INTEGER NOT NULL DEFAULT 0;
'@ | Set-Content .\prisma\migrations\20261011120000_add_email_verification\migration.sql