// Business-rule and access-control checks used by the Sprint 6 security audit (see docs/SECURITY_AUDIT.md).
// Rule numbers follow the comments in the code (RM2/RM9 encryption, RM3 activation, RM5 revoke, RM6 one vote,
// RM10 state machine) - the matrix in the audit document says which RM each test backs.
const crypto = require("crypto");
const h = require("../helpers/e2e");

const { prisma, api, createUser, createCapsule } = h;
const CONTENT_B64 = Buffer.from("super-secret-ciphertext-marker-9f3a").toString("base64");
const THRESHOLDS = { inactivityThresholdDays: 30, graceWindowDays: 7, validationThreshold: 1 };
const rand = (n) => crypto.randomBytes(n).toString("base64");

let T, G, B, X, ADMIN, capsuleId;

beforeAll(async () => {
  await h.seedPermissions();
  [T, G, B, X, ADMIN] = [
    await createUser("br-t"),
    await createUser("br-g"),
    await createUser("br-b"),
    await createUser("br-x"),
    await createUser("br-admin", { role: "ADMIN" }),
  ];
  capsuleId = await createCapsule(T, { guarantors: [G], beneficiaries: [B], thresholds: THRESHOLDS, content: CONTENT_B64, activate: true });
});
afterAll(async () => {
  await h.cleanup();
  await prisma.$disconnect();
});

describe("Authentication on every capsule route", () => {
  it.each([
    ["get", "/api/capsules"],
    ["post", "/api/capsules"],
    ["get", `/api/capsules/${"00000000-0000-0000-0000-000000000000"}`],
    ["get", "/api/notifications"],
    ["get", "/api/keys/me"],
    ["get", "/api/permissions/check?role=TESTATOR&keys=capsule.create"],
  ])("%s %s -> 401 without a token", async (method, path) => {
    expect((await api(method, path)).status).toBe(401);
  });

  it("admin-only routes refuse ordinary users", async () => {
    for (const [method, path] of [["get", "/api/permissions"], ["get", "/api/audit"], ["get", "/api/audit/verify"]]) {
      expect([path, (await api(method, path, T.token)).status]).toEqual([path, 403]);
    }
  });
});

describe("Ownership isolation (a stranger learns nothing)", () => {
  it("another user gets 404 (not 403) on every owner-side endpoint", async () => {
    const calls = [
      ["get", `/api/capsules/${capsuleId}`],
      ["get", `/api/capsules/${capsuleId}/content`],
      ["patch", `/api/capsules/${capsuleId}`, { title: "hijack" }],
      ["delete", `/api/capsules/${capsuleId}`],
      ["post", `/api/capsules/${capsuleId}/revoke`],
      ["post", `/api/capsules/${capsuleId}/activate`],
      ["post", `/api/capsules/${capsuleId}/confirm-activity`],
      ["put", `/api/capsules/${capsuleId}/thresholds`, THRESHOLDS],
      ["get", `/api/capsules/${capsuleId}/key-recipients`],
    ];
    for (const [method, path, body] of calls) {
      const res = await api(method, path, X.token, body);
      expect([method, path, res.status]).toEqual([method, path, 404]);
    }
    expect((await prisma.capsule.findUnique({ where: { id: capsuleId } })).title).toBe("E2E capsule");
  });

  it("a stranger cannot use the shared (guarantor/beneficiary) endpoints either", async () => {
    for (const path of [`/shared`, `/shared/content`, `/shared/key`]) {
      expect([path, (await api("get", `/api/capsules/${capsuleId}${path}`, X.token)).status]).toEqual([path, 404]);
    }
  });

  it("the owner's list never contains someone else's capsule", async () => {
    const res = await api("get", "/api/capsules", X.token);
    expect(res.status).toBe(200);
    expect(res.body.capsules.asTestator).toEqual([]);
    expect(res.body.capsules.asGuarantor).toEqual([]);
    expect(res.body.capsules.asBeneficiary).toEqual([]);
  });
});

describe("RM2 / RM9 - the server never exposes or interprets the ciphertext", () => {
  it("no metadata endpoint ever returns the encrypted blob", async () => {
    const responses = [
      await api("get", "/api/capsules", T.token),
      await api("get", `/api/capsules/${capsuleId}`, T.token),
      await api("get", `/api/capsules/${capsuleId}/shared`, G.token),
      await api("get", `/api/capsules/${capsuleId}/shared`, B.token),
      await api("get", "/api/capsules", B.token),
    ];
    for (const res of responses) {
      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).not.toContain(CONTENT_B64);
      expect(JSON.stringify(res.body)).not.toMatch(/encryptedContent"/);
    }
  });

  it("only the owner can fetch the blob while the capsule is not unlocked", async () => {
    const own = await api("get", `/api/capsules/${capsuleId}/content`, T.token);
    expect(own.status).toBe(200);
    expect(own.body.encryptedContentBase64).toBe(CONTENT_B64);
    expect((await api("get", `/api/capsules/${capsuleId}/content`, B.token)).status).toBe(404);
    expect((await api("get", `/api/capsules/${capsuleId}/shared/content`, B.token)).status).toBe(403);
  });
});

describe("Membership rules", () => {
  it("a testator cannot be their own guarantor or beneficiary", async () => {
    const id = await createCapsule(T, { thresholds: THRESHOLDS });
    expect((await api("post", `/api/capsules/${id}/guarantors`, T.token, { email: T.email })).status).toBe(400);
    expect((await api("post", `/api/capsules/${id}/beneficiaries`, T.token, { email: T.email })).status).toBe(400);
  });

  it("the same person cannot be added twice; unknown emails are refused", async () => {
    const id = await createCapsule(T, { thresholds: THRESHOLDS });
    expect((await api("post", `/api/capsules/${id}/guarantors`, T.token, { email: G.email })).status).toBe(201);
    expect((await api("post", `/api/capsules/${id}/guarantors`, T.token, { email: G.email })).status).toBe(409);
    expect((await api("post", `/api/capsules/${id}/beneficiaries`, T.token, { email: "nobody@example.test" })).status).toBe(404);
  });

  it("input validation rejects malformed bodies (zod)", async () => {
    expect((await api("post", "/api/capsules", T.token, { title: "", type: "MESSAGE" })).status).toBe(400);
    expect((await api("post", "/api/capsules", T.token, { title: "x", type: "VIDEO" })).status).toBe(400);
    const id = await createCapsule(T, {});
    for (const bad of [
      { inactivityThresholdDays: 0, graceWindowDays: 7, validationThreshold: 1 },
      { inactivityThresholdDays: 30, graceWindowDays: 7, validationThreshold: 99 },
      { inactivityThresholdDays: 30.5, graceWindowDays: 7, validationThreshold: 1 },
    ]) {
      expect((await api("put", `/api/capsules/${id}/thresholds`, T.token, bad)).status).toBe(400);
    }
  });
});

describe("RBAC - the permission matrix really blocks actions", () => {
  it("an admin switching off capsule.create makes creation fail with 403, and back on restores it", async () => {
    const off = await api("patch", "/api/permissions/TESTATOR/capsule.create", ADMIN.token, { enabled: false });
    expect(off.status).toBe(200);
    try {
      const blocked = await api("post", "/api/capsules", T.token, { title: "x", type: "MESSAGE" });
      expect(blocked.status).toBe(403);
      expect(blocked.body.error.message).toMatch(/capsule creation is currently disabled/i);
    } finally {
      await api("patch", "/api/permissions/TESTATOR/capsule.create", ADMIN.token, { enabled: true });
    }
    expect((await api("post", "/api/capsules", T.token, { title: "x", type: "MESSAGE" })).status).toBe(201);
    // Both changes (off, then on) are in the audit chain.
    await h.waitFor(
      async () => (await prisma.auditLog.count({ where: { userId: ADMIN.id, action: "PERMISSION_CHANGED" } })) >= 2,
      { message: "two PERMISSION_CHANGED audit entries" }
    );
  });

  it("rejects unknown roles and permissions", async () => {
    expect((await api("patch", "/api/permissions/HACKER/capsule.create", ADMIN.token, { enabled: false })).status).toBe(400);
    expect((await api("patch", "/api/permissions/TESTATOR/does.not.exist", ADMIN.token, { enabled: false })).status).toBe(404);
  });
});

describe("Device-key sharing (sealed passphrase) respects the lifecycle", () => {
  it("is only delivered once the capsule is unlocked, dies with a key change, and is wiped on revoke", async () => {
    const t = await createUser("keys-t");
    const g = await createUser("keys-g");
    const b = await createUser("keys-b");
    const id = await createCapsule(t, { guarantors: [g], beneficiaries: [b], thresholds: THRESHOLDS, content: CONTENT_B64, activate: true });

    const publicKey = rand(32);
    expect((await api("put", "/api/keys/me", b.token, { publicKey })).status).toBe(200);
    expect((await api("put", "/api/keys/me", b.token, { publicKey: "not-base64!" })).status).toBe(400);

    const recipients = await api("get", `/api/capsules/${id}/key-recipients`, t.token);
    expect(recipients.body.recipients[0]).toEqual(expect.objectContaining({ userId: b.id, publicKey, hasShare: false }));

    const share = { userId: b.id, publicKey, wrappedKey: rand(120) };
    expect((await api("put", `/api/capsules/${id}/key-shares`, t.token, { shares: [share] })).body.saved).toBe(1);
    // Sealed to a key the recipient does not hold any more -> refused.
    expect((await api("put", `/api/capsules/${id}/key-shares`, t.token, { shares: [{ ...share, publicKey: rand(32) }] })).status).toBe(409);
    // Only beneficiaries can receive a share.
    expect((await api("put", `/api/capsules/${id}/key-shares`, t.token, { shares: [{ ...share, userId: g.id }] })).status).toBe(400);

    // Locked: not delivered.
    expect((await api("get", `/api/capsules/${id}/shared/key`, b.token)).status).toBe(403);

    // Unlocked (state forced in the DB: the real path is covered by the lifecycle suite).
    await prisma.capsule.update({ where: { id }, data: { state: "UNLOCKED", unlockedAt: new Date() } });
    const delivered = await api("get", `/api/capsules/${id}/shared/key`, b.token);
    expect(delivered.status).toBe(200);
    expect(delivered.body.wrappedKey).toBe(share.wrappedKey);
    // A guarantor can never obtain it.
    expect((await api("get", `/api/capsules/${id}/shared/key`, g.token)).status).toBe(404);

    // Replacing the device key invalidates every share sealed to the old one.
    await api("put", "/api/keys/me", b.token, { publicKey: rand(32) });
    expect(await prisma.capsuleKeyShare.count({ where: { capsuleId: id } })).toBe(0);

    // Revoke wipes shares too (new in Sprint 6).
    const id2 = await createCapsule(t, { guarantors: [g], beneficiaries: [b], thresholds: THRESHOLDS, content: CONTENT_B64, activate: true });
    const pk2 = (await api("get", "/api/keys/me", b.token)).body.publicKey;
    await api("put", `/api/capsules/${id2}/key-shares`, t.token, { shares: [{ userId: b.id, publicKey: pk2, wrappedKey: rand(120) }] });
    expect(await prisma.capsuleKeyShare.count({ where: { capsuleId: id2 } })).toBe(1);
    expect((await api("post", `/api/capsules/${id2}/revoke`, t.token)).status).toBe(200);
    expect(await prisma.capsuleKeyShare.count({ where: { capsuleId: id2 } })).toBe(0);
  });
});

describe("Abuse protection", () => {
  it("the validation endpoint is rate limited per user (11th attempt in the window -> 429)", async () => {
    // ACTIVE capsule: every attempt is refused with 409, but each one counts against the limiter.
    const statuses = [];
    for (let i = 0; i < 11; i += 1) statuses.push((await api("post", `/api/capsules/${capsuleId}/validate`, G.token)).status);
    expect(statuses.slice(0, 10).every((s) => s === 409)).toBe(true);
    expect(statuses[10]).toBe(429);
    // The limit is per user, not global.
    const other = await createUser("br-g2");
    expect((await api("post", `/api/capsules/${capsuleId}/validate`, other.token)).status).not.toBe(429);
  });
});
