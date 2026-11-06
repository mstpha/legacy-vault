-- CreateEnum
CREATE TYPE "CapsuleType" AS ENUM ('DOCUMENT', 'CREDENTIAL', 'MESSAGE');

-- CreateEnum
CREATE TYPE "CapsuleState" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVITY_ALERT', 'PENDING_VALIDATION', 'UNLOCKED', 'REVOKED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('GUARANTOR_ASSIGNED', 'INACTIVITY_ALERT', 'VALIDATION_REQUEST', 'CAPSULE_UNLOCKED', 'CAPSULE_ACCESS_ATTEMPT');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "mfaSecret" TEXT,
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "lastLoginAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "replacedByToken" TEXT,
    "createdByIp" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "capsules" (
    "id" TEXT NOT NULL,
    "testatorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "CapsuleType" NOT NULL,
    "state" "CapsuleState" NOT NULL DEFAULT 'DRAFT',
    "encryptedContent" BYTEA,
    "inactivityThresholdDays" INTEGER NOT NULL DEFAULT 90,
    "graceWindowDays" INTEGER NOT NULL DEFAULT 14,
    "validationThreshold" INTEGER NOT NULL DEFAULT 2,
    "validationsReceived" INTEGER NOT NULL DEFAULT 0,
    "lastActivityCheckAt" TIMESTAMP(3),
    "alertSentAt" TIMESTAMP(3),
    "graceWindowExpiresAt" TIMESTAMP(3),
    "unlockedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "capsules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "capsule_guarantors" (
    "id" TEXT NOT NULL,
    "capsuleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "capsule_guarantors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "capsule_beneficiaries" (
    "id" TEXT NOT NULL,
    "capsuleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firstAccessedAt" TIMESTAMP(3),

    CONSTRAINT "capsule_beneficiaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "validations" (
    "id" TEXT NOT NULL,
    "capsuleId" TEXT NOT NULL,
    "guarantorId" TEXT NOT NULL,
    "validatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "validations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "capsuleId" TEXT,
    "action" TEXT NOT NULL,
    "metadata" JSONB,
    "prevHash" TEXT,
    "hash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "payload" JSONB,
    "sentAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");

-- CreateIndex
CREATE INDEX "capsules_testatorId_idx" ON "capsules"("testatorId");

-- CreateIndex
CREATE INDEX "capsules_state_idx" ON "capsules"("state");

-- CreateIndex
CREATE UNIQUE INDEX "capsule_guarantors_capsuleId_userId_key" ON "capsule_guarantors"("capsuleId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "capsule_beneficiaries_capsuleId_userId_key" ON "capsule_beneficiaries"("capsuleId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "validations_capsuleId_guarantorId_key" ON "validations"("capsuleId", "guarantorId");

-- CreateIndex
CREATE INDEX "audit_logs_capsuleId_idx" ON "audit_logs"("capsuleId");

-- CreateIndex
CREATE INDEX "audit_logs_userId_idx" ON "audit_logs"("userId");

-- CreateIndex
CREATE INDEX "notifications_userId_idx" ON "notifications"("userId");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capsules" ADD CONSTRAINT "capsules_testatorId_fkey" FOREIGN KEY ("testatorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capsule_guarantors" ADD CONSTRAINT "capsule_guarantors_capsuleId_fkey" FOREIGN KEY ("capsuleId") REFERENCES "capsules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capsule_guarantors" ADD CONSTRAINT "capsule_guarantors_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capsule_beneficiaries" ADD CONSTRAINT "capsule_beneficiaries_capsuleId_fkey" FOREIGN KEY ("capsuleId") REFERENCES "capsules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capsule_beneficiaries" ADD CONSTRAINT "capsule_beneficiaries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "validations" ADD CONSTRAINT "validations_capsuleId_fkey" FOREIGN KEY ("capsuleId") REFERENCES "capsules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "validations" ADD CONSTRAINT "validations_guarantorId_fkey" FOREIGN KEY ("guarantorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_capsuleId_fkey" FOREIGN KEY ("capsuleId") REFERENCES "capsules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
