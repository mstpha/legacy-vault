const crypto = require("crypto");
const bcrypt = require("bcrypt");
const request = require("supertest");

const app = require("../../src/app");
const prisma = require("../../src/config/db");
const { signAccessToken } = require("../../src/services/token.service");
const { PERMISSIONS } = require("../../prisma/seed");
const mailer = require("../../src/config/mailer");

const RUN_ID = crypto.randomBytes(4).toString("hex");
const EMAIL_PREFIX = `e2e-${RUN_ID}-`;
const DAY_MS = 24 * 60 * 60 * 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Polls until fn() returns something truthy (notifications and audit entries are written in the background).
async function waitFor(fn, { timeout = 8000, interval = 100, message = "condition" } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${message}`);
    await sleep(interval);
  }
}

// Makes sure the role/permission matrix exists and every permission is enabled.
async function seedPermissions() {
  for (const p of PERMISSIONS) {
    await prisma.rolePermission.upsert({
      where: { role_permission: { role: p.role, permission: p.permission } },
      update: { enabled: true, label: p.label },
      create: { ...p, enabled: true },
    });
  }
}

// Creates a verified user straight in the DB (bcrypt cost 4: fast, and login() accepts any cost)
// and a ready-made access token. Registration/login have their own dedicated test file.
//
// requireAuth refreshes users.lastSeenAt in the background on a user's FIRST request (then at most once
// per hour in tests). If that write landed after a test moved lastSeenAt into the past, the sweep would
// not see the testator as inactive and the test would be flaky. So by default we "prime" the user: one
// request, then wait for the touch to land. After that, no further background write happens.
async function createUser(label, { role = "TESTATOR", password = "SuperSecret123!", prime = true } = {}) {
  const LONG_AGO = new Date("2000-01-01T00:00:00Z");
  const user = await prisma.user.create({
    data: {
      email: `${EMAIL_PREFIX}${label}@example.test`,
      passwordHash: await bcrypt.hash(password, 4),
      fullName: `E2E ${label}`,
      emailVerified: true,
      role,
      lastSeenAt: LONG_AGO,
    },
  });
  const token = signAccessToken(user);
  if (prime) {
    await api("get", "/api/auth/me", token);
    await waitFor(
      async () => (await prisma.user.findUnique({ where: { id: user.id }, select: { lastSeenAt: true } })).lastSeenAt > LONG_AGO,
      { message: `lastSeenAt touch for ${label}` }
    );
  }
  return { user, id: user.id, email: user.email, password, token };
}

// Thin supertest wrapper: api("post", "/api/capsules", token, body)
function api(method, path, token, body) {
  let req = request(app)[method](path);
  if (token) req = req.set("Authorization", `Bearer ${token}`);
  return body === undefined ? req : req.send(body);
}

// Builds a capsule through the PUBLIC API only, up to (but not including) activation unless asked.
async function createCapsule(testator, { guarantors = [], beneficiaries = [], thresholds, content, activate = false } = {}) {
  const created = await api("post", "/api/capsules", testator.token, { title: "E2E capsule", type: "MESSAGE" });
  if (created.status !== 201) throw new Error(`create capsule failed: ${created.status} ${JSON.stringify(created.body)}`);
  const id = created.body.capsule.id;

  if (thresholds) {
    const res = await api("put", `/api/capsules/${id}/thresholds`, testator.token, thresholds);
    if (res.status !== 200) throw new Error(`thresholds failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  if (content) {
    const res = await api("patch", `/api/capsules/${id}`, testator.token, { encryptedContentBase64: content });
    if (res.status !== 200) throw new Error(`content failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  for (const g of guarantors) {
    const res = await api("post", `/api/capsules/${id}/guarantors`, testator.token, { email: g.email });
    if (res.status !== 201) throw new Error(`add guarantor failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  for (const b of beneficiaries) {
    const res = await api("post", `/api/capsules/${id}/beneficiaries`, testator.token, { email: b.email });
    if (res.status !== 201) throw new Error(`add beneficiary failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  if (activate) {
    const res = await api("post", `/api/capsules/${id}/activate`, testator.token);
    if (res.status !== 200) throw new Error(`activate failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return id;
}

const getState = async (capsuleId) => (await prisma.capsule.findUnique({ where: { id: capsuleId }, select: { state: true } })).state;

// Time travel helpers (the sweep compares against the real clock, so we move the data, not the clock).
const ageTestator = (userId, days) =>
  prisma.user.update({ where: { id: userId }, data: { lastSeenAt: new Date(Date.now() - days * DAY_MS) } });
const expireGraceWindow = (capsuleId) =>
  prisma.capsule.update({ where: { id: capsuleId }, data: { graceWindowExpiresAt: new Date(Date.now() - 60 * 1000) } });

const auditCount = (capsuleId, action) => prisma.auditLog.count({ where: { capsuleId, action } });
const notificationsFor = (userId, type) => prisma.notification.findMany({ where: { userId, type } });

// Waits until nothing new is being appended to the audit chain (background writes drained).
async function waitForAuditQuiet() {
  let previous = -1;
  for (let i = 0; i < 40; i += 1) {
    const current = await prisma.auditLog.count();
    if (current === previous) return;
    previous = current;
    await sleep(250);
  }
}

// Emails captured by the mocked mailer.
const sentEmails = () => mailer.__sent;
function lastVerificationCode(toEmail) {
  const mail = [...mailer.__sent].reverse().find((m) => m.to === toEmail && /verification code is (\d{6})/.test(m.text || ""));
  return mail ? /verification code is (\d{6})/.exec(mail.text)[1] : null;
}

// Removes everything this run created. audit_logs is append-only by design (trigger), so it stays.
async function cleanup() {
  const users = await prisma.user.findMany({ where: { email: { startsWith: EMAIL_PREFIX } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  if (ids.length) {
    await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
    await prisma.validation.deleteMany({ where: { guarantorId: { in: ids } } });
    await prisma.capsuleKeyShare.deleteMany({ where: { userId: { in: ids } } });
    await prisma.capsuleGuarantor.deleteMany({ where: { userId: { in: ids } } });
    await prisma.capsuleBeneficiary.deleteMany({ where: { userId: { in: ids } } });
    await prisma.capsule.deleteMany({ where: { testatorId: { in: ids } } }); // cascades files/validations/shares
    await prisma.user.deleteMany({ where: { id: { in: ids } } }); // cascades refresh tokens
  }
}

module.exports = {
  app,
  prisma,
  EMAIL_PREFIX,
  DAY_MS,
  sleep,
  waitFor,
  seedPermissions,
  createUser,
  api,
  createCapsule,
  getState,
  ageTestator,
  expireGraceWindow,
  auditCount,
  notificationsFor,
  waitForAuditQuiet,
  sentEmails,
  lastVerificationCode,
  cleanup,
};
