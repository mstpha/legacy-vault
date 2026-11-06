-- Sprint 6 repair: users.publicKey / publicKeyUpdatedAt and capsule_key_shares are in schema.prisma and
-- used by keys.service, but no migration created them, so a database built from the migration history
-- lacked them. IF NOT EXISTS keeps this a no-op on databases that already have them (e.g. created with db push).
ALTER TABLE "users"
    ADD COLUMN IF NOT EXISTS "publicKey" TEXT,
    ADD COLUMN IF NOT EXISTS "publicKeyUpdatedAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "capsule_key_shares" (
    "id" TEXT NOT NULL,
    "capsuleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "wrappedKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "capsule_key_shares_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "capsule_key_shares_capsuleId_fkey" FOREIGN KEY ("capsuleId") REFERENCES "capsules"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "capsule_key_shares_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "capsule_key_shares_capsuleId_userId_key" ON "capsule_key_shares"("capsuleId", "userId");
