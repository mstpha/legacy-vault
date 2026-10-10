const prisma = require("../config/db");
const logger = require("../config/logger");
const { writeAuditLog } = require("./audit.service");
const { createNotification } = require("./notification.service");



const daysToMs = (days) => days * 24 * 60 * 60 * 1000;

// Runs on a schedule (see src/jobs/inactivityWorker.js). Looks at every ACTIVE
// and INACTIVITY_ALERT capsule and moves it forward in the RM10 state machine
// as needed. Intentionally small, pure, and testable — no BullMQ/Redis concepts
// leak into this file.
async function runInactivitySweep() {
  const [activated, alerting] = await Promise.all([
    processActiveCapsules(),
    processAlertingCapsules(),
  ]);
  return { alertsSent: activated, escalatedToValidation: alerting };
}

// ACTIVE -> INACTIVITY_ALERT: testator's last activity exceeded their own threshold.
async function processActiveCapsules() {
  const activeCapsules = await prisma.capsule.findMany({
    where: { state: "ACTIVE" },
    include: { testator: true },
  });

  let count = 0;
  for (const capsule of activeCapsules) {
    const lastActivity = capsule.testator.lastSeenAt || capsule.createdAt;
    const inactiveSince = Date.now() - lastActivity.getTime();

    if (inactiveSince < daysToMs(capsule.inactivityThresholdDays)) continue;

    const graceWindowExpiresAt = new Date(Date.now() + daysToMs(capsule.graceWindowDays));

    await prisma.capsule.update({
      where: { id: capsule.id },
      data: { state: "INACTIVITY_ALERT", alertSentAt: new Date(), graceWindowExpiresAt },
    });

    await createNotification(capsule.testatorId, "INACTIVITY_ALERT", {
      capsuleId: capsule.id,
      graceWindowExpiresAt,
    });
    writeAuditLog({ capsuleId: capsule.id, action: "INACTIVITY_ALERT_TRIGGERED" });
    count++;
  }
  return count;
}

// INACTIVITY_ALERT -> PENDING_VALIDATION: grace window expired with no response.
// (The reverse transition, back to ACTIVE, happens in capsule.service#confirmActivity
// when the testator responds in time — not handled by this sweep.)
async function processAlertingCapsules() {
  const alertingCapsules = await prisma.capsule.findMany({
    where: { state: "INACTIVITY_ALERT", graceWindowExpiresAt: { lte: new Date() } },
    include: { guarantors: { include: { user: true } } },
  });

  let count = 0;
  for (const capsule of alertingCapsules) {
    await prisma.capsule.update({
      where: { id: capsule.id },
      data: { state: "PENDING_VALIDATION" },
    });

    await Promise.all(
      capsule.guarantors.map((g) =>
        createNotification(g.userId, "VALIDATION_REQUEST", { capsuleId: capsule.id })
      )
    );
    writeAuditLog({ capsuleId: capsule.id, action: "ESCALATED_TO_PENDING_VALIDATION" });
    count++;
  }
  return count;
}

module.exports = { runInactivitySweep };
