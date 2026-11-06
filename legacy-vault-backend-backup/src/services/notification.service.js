const { getDb } = require("../config/db");
const logger = require("../config/logger");
const { sendEmail } = require("../config/mailer");
const { describeNotification } = require("../utils/notificationContent");
const { renderEmail } = require("../utils/emailTemplate");

// --- Email delivery (always in the background) ----------------------------------

// Tracked so scripts (like run-sweep.js) can wait for emails before exiting.
const pendingEmails = new Set();

function sendInBackground(job) {
  const promise = job.catch((err) => {
    // Email delivery must never block or fail the underlying action.
    logger.error("Failed to send notification email", { err: err.message });
  });
  pendingEmails.add(promise);
  promise.finally(() => pendingEmails.delete(promise));
}

async function flushPendingEmails() {
  await Promise.allSettled([...pendingEmails]);
}

async function loadCapsuleContext(payload) {
  if (!payload.capsuleId) return {};
  const capsule = await getDb().capsule.findUnique({
    where: { id: payload.capsuleId },
    select: { title: true, testator: { select: { fullName: true } } },
  });
  return { capsuleTitle: capsule?.title, testatorName: capsule?.testator?.fullName };
}

async function deliverEmail(userId, type, payload) {
  // Sprint 6 fix: this used to bail out unless MAILTRAP_API_KEY was set, a leftover from before the
  // mailer moved to SMTP, so notification emails were never sent. sendEmail() itself already
  // logs and returns { sent: false } when SMTP is not configured.
  const [user, ctx] = await Promise.all([
    getDb().user.findUnique({ where: { id: userId }, select: { email: true, fullName: true } }),
    loadCapsuleContext(payload),
  ]);
  if (!user) return;

  const content = describeNotification(type, payload, ctx);
  const { html, text } = renderEmail({ recipientName: user.fullName, ...content });

  await sendEmail({ to: user.email, subject: content.subject, text, html, category: type });
}

// Always writes the Notification row (source of truth, shown in the in-app inbox);
// the email goes out in the background on top of it.
async function createNotification(userId, type, payload = {}) {
  const notification = await getDb().notification.create({
    data: { userId, type, payload, sentAt: new Date() },
  });

  sendInBackground(deliverEmail(userId, type, payload));
  return notification;
}

// --- In-app inbox ------------------------------------------------------------------

async function listNotifications(userId) {
  const [rows, unreadCount] = await Promise.all([
    getDb().notification.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 50 }),
    getDb().notification.count({ where: { userId, readAt: null } }),
  ]);

  const capsuleIds = [...new Set(rows.map((r) => r.payload?.capsuleId).filter(Boolean))];
  const capsules = capsuleIds.length
    ? await getDb().capsule.findMany({
        where: { id: { in: capsuleIds } },
        select: { id: true, title: true, testator: { select: { fullName: true } } },
      })
    : [];
  const capsuleById = new Map(capsules.map((c) => [c.id, c]));

  const notifications = rows.map((row) => {
    const payload = row.payload || {};
    const capsule = capsuleById.get(payload.capsuleId);
    const content = describeNotification(row.type, payload, {
      capsuleTitle: capsule?.title,
      testatorName: capsule?.testator?.fullName,
    });

    return {
      id: row.id,
      type: row.type,
      title: content.title,
      message: content.message,
      tone: content.tone,
      target: content.target,
      capsuleId: capsule ? capsule.id : null,
      read: !!row.readAt,
      createdAt: row.createdAt,
    };
  });

  return { notifications, unreadCount };
}

async function countUnread(userId) {
  return getDb().notification.count({ where: { userId, readAt: null } });
}

async function markRead(userId, notificationId) {
  await getDb().notification.updateMany({
    where: { id: notificationId, userId, readAt: null },
    data: { readAt: new Date() },
  });
}

async function markAllRead(userId) {
  await getDb().notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
}

module.exports = {
  createNotification,
  flushPendingEmails,
  listNotifications,
  countUnread,
  markRead,
  markAllRead,
};