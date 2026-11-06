-- Sprint 6 bug fix: capsule.service creates these notification types and notificationContent.js renders
-- them, but the enum only had 5 values, so Postgres rejected them (swallowed by notifyInBackground).
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'BENEFICIARY_ASSIGNED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'VALIDATION_RECEIVED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'CAPSULE_REVOKED';
