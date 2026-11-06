// End-to-end coverage of RM10: the 7 capsule states and every legal / illegal transition.
//
//   DRAFT -> ACTIVE -> INACTIVITY_ALERT -> PENDING_VALIDATION -> UNLOCKED -> ARCHIVED
//                          |  (back to ACTIVE when the testator confirms)
//   REVOKED: reachable from DRAFT / ACTIVE / INACTIVITY_ALERT / PENDING_VALIDATION only (RM5)
//
// Everything goes through the real Express app (Supertest) and a real Postgres test database.
// Only email, Supabase Storage and Redis are mocked (tests/setup/mocks.js).
const h = require("../helpers/e2e");
const { runInactivitySweep } = require("../../src/services/monitoring.service");

const { prisma, api, createUser, createCapsule, getState } = h;

const CONTENT_B64 = Buffer.from("ciphertext-blob-not-readable-by-the-server").toString("base64");
const THRESHOLDS = { inactivityThresholdDays: 30, graceWindowDays: 7, validationThreshold: 2 };

// One isolated "world" per scenario: its own testator, so ageing one testator never affects another capsule.
async function newWorld(label, { activate = true, guarantorCount = 2 } = {}) {
  const testator = await createUser(`${label}-t`);
  const guarantors = [];
  for (let i = 1; i <= guarantorCount; i += 1) guarantors.push(await createUser(`${label}-g${i}`));
  const beneficiaries = [await createUser(`${label}-b1`), await createUser(`${label}-b2`)];
  const capsuleId = await createCapsule(testator, {
    guarantors,
    beneficiaries,
    thresholds: THRESHOLDS,
    content: CONTENT_B64,
    activate,
  });
  return { testator, guarantors, beneficiaries, capsuleId };
}

// --- drive a world forward through the real engine ---------------------------------------------
async function toInactivityAlert(w) {
  await h.ageTestator(w.testator.id, 45); // threshold is 30 days
  await runInactivitySweep();
  expect(await getState(w.capsuleId)).toBe("INACTIVITY_ALERT");
}
async function toPendingValidation(w) {
  await toInactivityAlert(w);
  await h.expireGraceWindow(w.capsuleId);
  await runInactivitySweep();
  expect(await getState(w.capsuleId)).toBe("PENDING_VALIDATION");
}
async function toUnlocked(w) {
  await toPendingValidation(w);
  for (const g of w.guarantors.slice(0, 2)) {
    const res = await api("post", `/api/capsules/${w.capsuleId}/validate`, g.token);
    expect(res.status).toBe(200);
  }
  expect(await getState(w.capsuleId)).toBe("UNLOCKED");
}
async function toArchived(w) {
  await toUnlocked(w);
  const res = await api("post", `/api/capsules/${w.capsuleId}/shared/confirm-read`, w.beneficiaries[0].token);
  expect(res.status).toBe(200);
  expect(await getState(w.capsuleId)).toBe("ARCHIVED");
}

// Operations that are only legal while the capsule is a DRAFT (RM10): all must be refused afterwards.
async function expectDraftOnlyOperationsRefused(w) {
  const id = w.capsuleId;
  const t = w.testator.token;
  const attempts = [
    ["patch", `/api/capsules/${id}`, { title: "renamed" }],
    ["delete", `/api/capsules/${id}`],
    ["put", `/api/capsules/${id}/thresholds`, THRESHOLDS],
    ["post", `/api/capsules/${id}/guarantors`, { email: w.beneficiaries[0].email }],
    ["post", `/api/capsules/${id}/beneficiaries`, { email: w.guarantors[0].email }],
    ["post", `/api/capsules/${id}/activate`],
  ];
  for (const [method, path, body] of attempts) {
    const res = await api(method, path, t, body);
    expect([method, path, res.status]).toEqual([method, path, 409]);
  }
}

beforeAll(async () => {
  await h.seedPermissions();
});
afterAll(async () => {
  await h.cleanup();
  await prisma.$disconnect();
});

describe("RM10 - full lifecycle, ordered (DRAFT -> ACTIVE -> ALERT -> PENDING -> UNLOCKED -> ARCHIVED)", () => {
  let w;
  let fileId;

  it("DRAFT: a new capsule starts as a draft and can be edited, extended and given an attachment", async () => {
    w = await newWorld("life", { activate: false });
    expect(await getState(w.capsuleId)).toBe("DRAFT");

    const edit = await api("patch", `/api/capsules/${w.capsuleId}`, w.testator.token, { title: "Final letter" });
    expect(edit.status).toBe(200);
    expect(edit.body.capsule.title).toBe("Final letter");
    expect(edit.body.capsule.state).toBe("DRAFT");

    const file = await api("post", `/api/capsules/${w.capsuleId}/files`, w.testator.token, {
      fileName: "will.pdf.enc",
      mimeType: "application/pdf",
      encryptedContentBase64: Buffer.from("encrypted-file-bytes").toString("base64"),
    });
    expect(file.status).toBe(201);
    fileId = file.body.file.id;
  });

  it("DRAFT -> ACTIVE (RM3): refused without a beneficiary, or without enough guarantors; allowed once both are met", async () => {
    const t = await createUser("rm3-t");
    const g = await createUser("rm3-g");
    const b = await createUser("rm3-b");

    // No beneficiary, no guarantor.
    const id = await createCapsule(t, { thresholds: THRESHOLDS });
    let res = await api("post", `/api/capsules/${id}/activate`, t.token);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/beneficiary/i);

    // A beneficiary but fewer guarantors than the validation threshold (2).
    await api("post", `/api/capsules/${id}/beneficiaries`, t.token, { email: b.email });
    await api("post", `/api/capsules/${id}/guarantors`, t.token, { email: g.email });
    res = await api("post", `/api/capsules/${id}/activate`, t.token);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/guarantor/i);
    expect(await getState(id)).toBe("DRAFT");

    // Lower the threshold to what we have: now it is allowed.
    await api("put", `/api/capsules/${id}/thresholds`, t.token, { ...THRESHOLDS, validationThreshold: 1 });
    res = await api("post", `/api/capsules/${id}/activate`, t.token);
    expect(res.status).toBe(200);
    expect(res.body.capsule.state).toBe("ACTIVE");
  });

  it("DRAFT -> ACTIVE: activating the lifecycle capsule (2 guarantors, 2 beneficiaries)", async () => {
    const res = await api("post", `/api/capsules/${w.capsuleId}/activate`, w.testator.token);
    expect(res.status).toBe(200);
    expect(res.body.capsule.state).toBe("ACTIVE");
    expect(res.body.capsule.encryptedContent).toBeUndefined(); // RM2/RM9: the blob never leaves in metadata
    expect(await h.waitFor(() => h.auditCount(w.capsuleId, "CAPSULE_ACTIVATED"))).toBe(1);
  });

  it("ACTIVE: draft-only operations are refused and beneficiaries cannot read the content", async () => {
    await expectDraftOnlyOperationsRefused(w);

    const res = await api("get", `/api/capsules/${w.capsuleId}/shared/content`, w.beneficiaries[0].token);
    expect(res.status).toBe(403);
    // The first blocked attempt tells the testator; hammering does not spam them (throttled).
    await h.waitFor(async () => (await h.notificationsFor(w.testator.id, "CAPSULE_ACCESS_ATTEMPT")).length === 1);
    await api("get", `/api/capsules/${w.capsuleId}/shared/content`, w.beneficiaries[0].token);
    await h.sleep(300);
    expect((await h.notificationsFor(w.testator.id, "CAPSULE_ACCESS_ATTEMPT")).length).toBe(1);

    // Validating makes no sense while the testator is active.
    const vote = await api("post", `/api/capsules/${w.capsuleId}/validate`, w.guarantors[0].token);
    expect(vote.status).toBe(409);
  });

  it("ACTIVE -> INACTIVITY_ALERT: the sweep alerts the testator once the threshold is exceeded", async () => {
    // A testator who was seen recently is left alone.
    const before = await runInactivitySweep();
    expect(await getState(w.capsuleId)).toBe("ACTIVE");
    expect(before).toEqual(expect.objectContaining({ alertsSent: expect.any(Number) }));

    await h.ageTestator(w.testator.id, 45);
    const result = await runInactivitySweep();
    expect(result.alertsSent).toBeGreaterThanOrEqual(1);

    const capsule = await prisma.capsule.findUnique({ where: { id: w.capsuleId } });
    expect(capsule.state).toBe("INACTIVITY_ALERT");
    expect(capsule.alertSentAt).toBeInstanceOf(Date);
    const graceMs = capsule.graceWindowExpiresAt.getTime() - capsule.alertSentAt.getTime();
    expect(Math.abs(graceMs - 7 * h.DAY_MS)).toBeLessThan(5000); // graceWindowDays = 7

    expect((await h.notificationsFor(w.testator.id, "INACTIVITY_ALERT")).length).toBe(1);
    expect(await h.auditCount(w.capsuleId, "INACTIVITY_ALERT_TRIGGERED")).toBe(1);
  });

  it("INACTIVITY_ALERT: the sweep is idempotent (no second alert) and draft-only operations stay refused", async () => {
    await runInactivitySweep();
    await runInactivitySweep();
    expect((await h.notificationsFor(w.testator.id, "INACTIVITY_ALERT")).length).toBe(1);
    expect(await h.auditCount(w.capsuleId, "INACTIVITY_ALERT_TRIGGERED")).toBe(1);
    await expectDraftOnlyOperationsRefused(w);
  });

  it("INACTIVITY_ALERT -> PENDING_VALIDATION: grace window expires, every guarantor is asked to vote", async () => {
    // Not expired yet: nothing happens.
    await runInactivitySweep();
    expect(await getState(w.capsuleId)).toBe("INACTIVITY_ALERT");

    await h.expireGraceWindow(w.capsuleId);
    const result = await runInactivitySweep();
    expect(result.escalatedToValidation).toBeGreaterThanOrEqual(1);
    expect(await getState(w.capsuleId)).toBe("PENDING_VALIDATION");

    for (const g of w.guarantors) {
      expect((await h.notificationsFor(g.id, "VALIDATION_REQUEST")).length).toBe(1);
    }
    expect(await h.auditCount(w.capsuleId, "ESCALATED_TO_PENDING_VALIDATION")).toBe(1);

    // Too late for the testator to cancel through confirm-activity.
    const confirm = await api("post", `/api/capsules/${w.capsuleId}/confirm-activity`, w.testator.token);
    expect(confirm.status).toBe(409);
  });

  it("PENDING_VALIDATION: still locked for beneficiaries; only guarantors may vote", async () => {
    const locked = await api("get", `/api/capsules/${w.capsuleId}/shared/content`, w.beneficiaries[0].token);
    expect(locked.status).toBe(403);

    const asGuarantor = await api("get", `/api/capsules/${w.capsuleId}/shared`, w.guarantors[0].token);
    expect(asGuarantor.status).toBe(200);
    expect(asGuarantor.body.capsule).toEqual(
      expect.objectContaining({ state: "PENDING_VALIDATION", canValidate: true, canViewContent: false, files: [] })
    );

    const outsider = await createUser("life-x");
    expect((await api("post", `/api/capsules/${w.capsuleId}/validate`, outsider.token)).status).toBe(404);
    // A beneficiary is not a guarantor.
    expect((await api("post", `/api/capsules/${w.capsuleId}/validate`, w.beneficiaries[0].token)).status).toBe(404);
  });

  it("PENDING_VALIDATION -> UNLOCKED: needs validationThreshold votes (RM6: one vote per guarantor)", async () => {
    const [g1, g2] = w.guarantors;

    const first = await api("post", `/api/capsules/${w.capsuleId}/validate`, g1.token);
    expect(first.status).toBe(200);
    expect(first.body.result).toEqual({ validationsReceived: 1, validationThreshold: 2, unlocked: false });
    expect(await getState(w.capsuleId)).toBe("PENDING_VALIDATION");

    const duplicate = await api("post", `/api/capsules/${w.capsuleId}/validate`, g1.token);
    expect(duplicate.status).toBe(409); // RM6
    expect((await prisma.capsule.findUnique({ where: { id: w.capsuleId } })).validationsReceived).toBe(1);

    const second = await api("post", `/api/capsules/${w.capsuleId}/validate`, g2.token);
    expect(second.status).toBe(200);
    expect(second.body.result.unlocked).toBe(true);

    const capsule = await prisma.capsule.findUnique({ where: { id: w.capsuleId } });
    expect(capsule.state).toBe("UNLOCKED");
    expect(capsule.unlockedAt).toBeInstanceOf(Date);

    // Everyone concerned is told.
    for (const b of w.beneficiaries) {
      await h.waitFor(async () => (await h.notificationsFor(b.id, "CAPSULE_UNLOCKED")).length === 1, { message: "beneficiary unlock notification" });
    }
    await h.waitFor(async () => (await h.notificationsFor(w.testator.id, "VALIDATION_RECEIVED")).length === 1, { message: "VALIDATION_RECEIVED" });
    expect(await h.waitFor(() => h.auditCount(w.capsuleId, "CAPSULE_UNLOCKED"))).toBe(1);
  });

  it("UNLOCKED: beneficiaries read the (still encrypted) content and files; guarantors still cannot", async () => {
    const [b1] = w.beneficiaries;

    const content = await api("get", `/api/capsules/${w.capsuleId}/shared/content`, b1.token);
    expect(content.status).toBe(200);
    expect(content.body.encryptedContentBase64).toBe(CONTENT_B64);

    const shared = await api("get", `/api/capsules/${w.capsuleId}/shared`, b1.token);
    expect(shared.body.capsule).toEqual(expect.objectContaining({ state: "UNLOCKED", canViewContent: true }));
    expect(shared.body.capsule.files).toHaveLength(1);

    const download = await api("get", `/api/capsules/${w.capsuleId}/shared/files/${fileId}`, b1.token);
    expect(download.status).toBe(200);
    expect(download.body.file.url).toMatch(/^https:\/\/storage\.test\//);

    // Guarantors never see content, even after the unlock.
    const g = w.guarantors[0];
    expect((await api("get", `/api/capsules/${w.capsuleId}/shared/content`, g.token)).status).toBe(404);
    const gView = await api("get", `/api/capsules/${w.capsuleId}/shared`, g.token);
    expect(gView.body.capsule).toEqual(expect.objectContaining({ canViewContent: false, files: [] }));

    // Delivering bytes is not a "read": the capsule stays UNLOCKED until the device confirms decryption.
    expect(await getState(w.capsuleId)).toBe("UNLOCKED");
    expect(await h.waitFor(() => h.auditCount(w.capsuleId, "CAPSULE_CONTENT_ACCESSED"))).toBeGreaterThanOrEqual(1);
    await expectDraftOnlyOperationsRefused(w);
  });

  it("UNLOCKED -> ARCHIVED: the first confirmed read archives; later reads stay possible", async () => {
    const [b1, b2] = w.beneficiaries;

    const first = await api("post", `/api/capsules/${w.capsuleId}/shared/confirm-read`, b1.token);
    expect(first.status).toBe(200);
    expect(first.body.result.archived).toBe(true);

    const capsule = await prisma.capsule.findUnique({ where: { id: w.capsuleId } });
    expect(capsule.state).toBe("ARCHIVED");
    expect(capsule.archivedAt).toBeInstanceOf(Date);
    const row = await prisma.capsuleBeneficiary.findUnique({
      where: { capsuleId_userId: { capsuleId: w.capsuleId, userId: b1.id } },
    });
    expect(row.firstAccessedAt).toBeInstanceOf(Date);

    // Second beneficiary: no error, no state flapping, content still readable.
    const second = await api("post", `/api/capsules/${w.capsuleId}/shared/confirm-read`, b2.token);
    expect(second.status).toBe(200);
    expect(await getState(w.capsuleId)).toBe("ARCHIVED");
    const again = await api("get", `/api/capsules/${w.capsuleId}/shared/content`, b2.token);
    expect(again.status).toBe(200);

    expect(await h.waitFor(() => h.auditCount(w.capsuleId, "CAPSULE_ARCHIVED"))).toBe(1);
  });

  it("ARCHIVED is terminal: no revoke, no confirm-activity, no validation, no edits", async () => {
    expect((await api("post", `/api/capsules/${w.capsuleId}/revoke`, w.testator.token)).status).toBe(409);
    expect((await api("post", `/api/capsules/${w.capsuleId}/confirm-activity`, w.testator.token)).status).toBe(409);
    expect((await api("post", `/api/capsules/${w.capsuleId}/validate`, w.guarantors[0].token)).status).toBe(409);
    await expectDraftOnlyOperationsRefused(w);
    await runInactivitySweep(); // the engine must not touch it either
    expect(await getState(w.capsuleId)).toBe("ARCHIVED");
  });
});

describe("RM10 - branches", () => {
  it("INACTIVITY_ALERT -> ACTIVE: the testator confirms activity inside the grace window", async () => {
    const w = await newWorld("back");
    await toInactivityAlert(w);

    const res = await api("post", `/api/capsules/${w.capsuleId}/confirm-activity`, w.testator.token);
    expect(res.status).toBe(200);
    expect(res.body.capsule.state).toBe("ACTIVE");

    const capsule = await prisma.capsule.findUnique({ where: { id: w.capsuleId } });
    expect(capsule.alertSentAt).toBeNull();
    expect(capsule.graceWindowExpiresAt).toBeNull();
    expect(Date.now() - (await prisma.user.findUnique({ where: { id: w.testator.id } })).lastSeenAt.getTime()).toBeLessThan(10000);

    // Seen just now, so the next sweep leaves it ACTIVE.
    await runInactivitySweep();
    expect(await getState(w.capsuleId)).toBe("ACTIVE");
    expect(await h.waitFor(() => h.auditCount(w.capsuleId, "ACTIVITY_CONFIRMED"))).toBe(1);

    // And confirm-activity is meaningless when there is no alert.
    expect((await api("post", `/api/capsules/${w.capsuleId}/confirm-activity`, w.testator.token)).status).toBe(409);
  });

  it("a testator who keeps using the app is never alerted (authenticated requests refresh lastSeenAt)", async () => {
    // Regression test for a real Sprint 6 finding: lastSeenAt used to be written only at login, so a
    // user whose last LOGIN was long ago (but who uses the app daily on refreshed tokens) looked inactive.
    const testator = await createUser("seen-t", { prime: false }); // lastSeenAt = year 2000
    const guarantors = [await createUser("seen-g1"), await createUser("seen-g2")];
    const beneficiary = await createUser("seen-b1");
    const capsuleId = await createCapsule(testator, {
      guarantors,
      beneficiaries: [beneficiary],
      thresholds: THRESHOLDS,
      content: CONTENT_B64,
      activate: true, // these requests are the "activity"
    });

    await h.waitFor(
      async () => Date.now() - (await prisma.user.findUnique({ where: { id: testator.id } })).lastSeenAt.getTime() < 60000,
      { message: "lastSeenAt refreshed by authenticated requests" }
    );
    await runInactivitySweep();
    expect(await getState(capsuleId)).toBe("ACTIVE");
  });

  describe("REVOKED (RM5): allowed at any point BEFORE unlock", () => {
    const reachable = {
      DRAFT: async (w) => w,
      ACTIVE: async (w) => w,
      INACTIVITY_ALERT: toInactivityAlert,
      PENDING_VALIDATION: toPendingValidation,
    };

    it.each(Object.keys(reachable))("%s -> REVOKED wipes the content and tells guarantors and beneficiaries", async (from) => {
      const w = await newWorld(`rev-${from.toLowerCase()}`, { activate: from !== "DRAFT" });
      await reachable[from](w);
      if (from !== "DRAFT") expect(await getState(w.capsuleId)).toBe(from);

      const res = await api("post", `/api/capsules/${w.capsuleId}/revoke`, w.testator.token);
      expect(res.status).toBe(200);
      expect(res.body.capsule.state).toBe("REVOKED");
      expect(res.body.capsule.hasContent).toBe(false);

      const row = await prisma.capsule.findUnique({ where: { id: w.capsuleId } });
      expect(row.encryptedContent).toBeNull();
      expect(row.revokedAt).toBeInstanceOf(Date);

      for (const u of [...w.guarantors, ...w.beneficiaries]) {
        await h.waitFor(async () => (await h.notificationsFor(u.id, "CAPSULE_REVOKED")).length === 1, { message: "CAPSULE_REVOKED notification" });
      }
      expect(await h.waitFor(() => h.auditCount(w.capsuleId, "CAPSULE_REVOKED"))).toBe(1);
    });

    it("REVOKED erases attachments too (RM10: le contenu est definitivement efface)", async () => {
      const storage = require("../../src/services/storage.service");
      storage.deleteFiles.mockClear();
      const w = await newWorld("rev-files", { activate: false });
      const file = await api("post", `/api/capsules/${w.capsuleId}/files`, w.testator.token, {
        fileName: "scan.pdf.enc",
        mimeType: "application/pdf",
        encryptedContentBase64: Buffer.from("enc").toString("base64"),
      });
      expect(file.status).toBe(201);
      expect(await prisma.capsuleFile.count({ where: { capsuleId: w.capsuleId } })).toBe(1);

      expect((await api("post", `/api/capsules/${w.capsuleId}/revoke`, w.testator.token)).status).toBe(200);
      expect(storage.deleteFiles).toHaveBeenCalledWith([expect.stringContaining(w.capsuleId)]);
      expect(await prisma.capsuleFile.count({ where: { capsuleId: w.capsuleId } })).toBe(0);
    });

    it("REVOKED is terminal: nothing can bring it back or unlock it", async () => {
      const w = await newWorld("rev-final");
      await toPendingValidation(w);
      await api("post", `/api/capsules/${w.capsuleId}/revoke`, w.testator.token);

      expect((await api("post", `/api/capsules/${w.capsuleId}/revoke`, w.testator.token)).status).toBe(409);
      expect((await api("post", `/api/capsules/${w.capsuleId}/activate`, w.testator.token)).status).toBe(409);
      expect((await api("post", `/api/capsules/${w.capsuleId}/confirm-activity`, w.testator.token)).status).toBe(409);
      expect((await api("post", `/api/capsules/${w.capsuleId}/validate`, w.guarantors[0].token)).status).toBe(409);
      expect((await api("get", `/api/capsules/${w.capsuleId}/shared/content`, w.beneficiaries[0].token)).status).toBe(403);
      await runInactivitySweep();
      expect(await getState(w.capsuleId)).toBe("REVOKED");
    });

    it.each(["UNLOCKED", "ARCHIVED"])("%s can no longer be revoked", async (stage) => {
      const w = await newWorld(`norev-${stage.toLowerCase()}`);
      await (stage === "UNLOCKED" ? toUnlocked : toArchived)(w);
      const res = await api("post", `/api/capsules/${w.capsuleId}/revoke`, w.testator.token);
      expect(res.status).toBe(409);
      expect(await getState(w.capsuleId)).toBe(stage);
      // ...and the content is intact.
      expect((await prisma.capsule.findUnique({ where: { id: w.capsuleId } })).encryptedContent).not.toBeNull();
    });
  });

  it("concurrency: simultaneous last votes unlock the capsule exactly once", async () => {
    const w = await newWorld("race", { guarantorCount: 3 });
    await toPendingValidation(w);

    const responses = await Promise.all(
      w.guarantors.map((g) => api("post", `/api/capsules/${w.capsuleId}/validate`, g.token))
    );
    // A request that lost the race may be refused (409) because the capsule is already unlocked.
    for (const r of responses) expect([200, 409]).toContain(r.status);
    const unlockers = responses.filter((r) => r.status === 200 && r.body.result.unlocked === true);
    expect(unlockers).toHaveLength(1);

    expect(await getState(w.capsuleId)).toBe("UNLOCKED");
    expect(await h.waitFor(() => h.auditCount(w.capsuleId, "CAPSULE_UNLOCKED"))).toBe(1);
    await h.sleep(300);
    expect(await h.auditCount(w.capsuleId, "CAPSULE_UNLOCKED")).toBe(1);
    expect((await prisma.capsule.findUnique({ where: { id: w.capsuleId } })).unlockedAt).toBeInstanceOf(Date);
  });

  it("concurrency: revoke racing the final unlock never leaves a revoked-but-unlocked mess", async () => {
    const w = await newWorld("race2");
    await toPendingValidation(w);
    const v1 = await api("post", `/api/capsules/${w.capsuleId}/validate`, w.guarantors[0].token);
    expect(v1.status).toBe(200);

    const [revoke, vote] = await Promise.all([
      api("post", `/api/capsules/${w.capsuleId}/revoke`, w.testator.token),
      api("post", `/api/capsules/${w.capsuleId}/validate`, w.guarantors[1].token),
    ]);
    const final = await prisma.capsule.findUnique({ where: { id: w.capsuleId } });
    if (final.state === "REVOKED") {
      expect(revoke.status).toBe(200);
      expect(final.encryptedContent).toBeNull();
    } else {
      // The unlock won: revoke must have been refused and the content must be intact (RM5).
      expect(final.state).toBe("UNLOCKED");
      expect(revoke.status).toBe(409);
      expect(final.encryptedContent).not.toBeNull();
    }
    expect(vote.status === 200 || vote.status === 409).toBe(true);
  });
});

describe("Tamper-evident audit trail across the whole lifecycle", () => {
  it("the hash chain verifies after all the transitions above (admin endpoint)", async () => {
    const admin = await createUser("audit-admin", { role: "ADMIN" });
    await h.waitForAuditQuiet();

    const res = await api("get", "/api/audit/verify", admin.token);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ valid: true, brokenAt: null }));
    expect(res.body.checked).toBeGreaterThan(20);

    // Non-admins are refused.
    const user = await createUser("audit-user");
    expect((await api("get", "/api/audit/verify", user.token)).status).toBe(403);
  });
});
