-- CreateEnum
CREATE TYPE "Role" AS ENUM ('TESTATOR', 'GUARANTOR', 'BENEFICIARY');

-- CreateTable
CREATE TABLE "capsule_files" (
    "id" TEXT NOT NULL,
    "capsuleId" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "capsule_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "id" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "permission" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "capsule_files_capsuleId_idx" ON "capsule_files"("capsuleId");

-- CreateIndex
CREATE UNIQUE INDEX "role_permissions_role_permission_key" ON "role_permissions"("role", "permission");

-- AddForeignKey
ALTER TABLE "capsule_files" ADD CONSTRAINT "capsule_files_capsuleId_fkey" FOREIGN KEY ("capsuleId") REFERENCES "capsules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
