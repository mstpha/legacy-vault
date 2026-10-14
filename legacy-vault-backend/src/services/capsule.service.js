const { Prisma } = require("@prisma/client");
const prisma = require("../config/db");
const logger = require("../config/logger");
const { ApiError } = require("../middleware/errorHandler");
const { assertPermission, checkPermissions } = require("./permissions.service");
const { uploadEncryptedFile, getSignedDownloadUrl } = require("./storage.service");
const { createNotification } = require("./notification.service");

// Hash-chained, append-only audit trail (see audit.service.js).
const { writeAuditLog } = require("./audit.service");

// --- Helpers ---------------------------------------------------------------------
//
// The encryptedContent column can be large, so every query selects "all columns
// except encryptedContent" unless the caller explicitly needs the blob.
const NO_CONTENT_SELECT = Object.fromEntries(
  Object.keys(Prisma.CapsuleScalarFieldEnum)
    .filter((field) => field !== "encryptedContent")
    .map((field) => [field, true])
);

const USER_BRIEF = { select: { id: true, email: true, fullName: true } };

async function hasStoredContent(capsuleId) {
  const count = await prisma.capsule.count({ where: { id: capsuleId, encryptedContent: { not: null } } });
  return count > 0;
}

// Updates a capsule and returns it WITHOUT the blob, plus a hasContent flag.
async function updateCapsule(capsuleId, data, forcedHasContent) {
  const [capsule, hasContent] = await Promise.all([
    prisma.capsule.update({ where: { id: capsuleId }, data, select: NO_CONTENT_SELECT }),
    forcedHasContent === undefined ? hasStoredContent(capsuleId) : Promise.resolve(forcedHasContent),
  ]);
  return { ...capsule, hasContent };
}

// Notifications never block or break the action that triggered them.
function notifyInBackground(task) {
  Promise.resolve(task).catch((err) => logger.error("notification_failed", { message: err.message }));
}

async function notifyUsers(userIds, type, payload) {
  await Promise.all([...new Set(userIds)].map((id) => createNotification(id, type, payload)));
}

async function getMemberIds(capsuleId) {
  const [guarantors, beneficiaries] = await Promise.all([
    prisma.capsuleGuarantor.findMany({ where: { capsuleId }, select: { userId: true } }),
    prisma.capsuleBeneficiary.findMany({ where: { capsuleId }, select: { userId: true } }),
  ]);
  return {
    guarantorIds: guarantors.map((g) => g.userId),
    beneficiaryIds: beneficiaries.map((b) => b.userId),
  };
}

// Avoid spamming the testator if someone keeps hammering a locked capsule.
const attemptThrottle = new Map();
function shouldNotifyAttempt(key) {
  const last = attemptThrottle.get(key) || 0;
  if (Date.now() - last < 10 * 60 * 1000) return false;
  attemptThrottle.set(key, Date.now());
  return true;
}

// --- Ownership / access guards -------------------------------------------------

async function getOwnedDraftCapsule(capsuleId, testatorId) {
  const capsule = await prisma.capsule.findUnique({ where: { id: capsuleId }, select: NO_CONTENT_SELECT });
  if (!capsule || capsule.testatorId !== testatorId) throw new ApiError(404, "Capsule not found.");
  if (capsule.state !== "DRAFT") throw new ApiError(409, "This action is only allowed while the capsule is a draft.");
  return capsule;
}

async function getOwnedCapsule(capsuleId, testatorId) {
  const capsule = await prisma.capsule.findUnique({ where: { id: capsuleId }, select: NO_CONTENT_SELECT });
  if (!capsule || capsule.testatorId !== testatorId) throw new ApiError(404, "Capsule not found.");
  return capsule;
}

// --- CRUD -----------------------------------------------------------------------

async function createCapsule(testatorId, { title, type }) {
  await assertPermission("TESTATOR", "capsule.create");

  const capsule = await prisma.capsule.create({
    data: { testatorId, title, type, state: "DRAFT" },
    select: NO_CONTENT_SELECT,
  });
  writeAuditLog({ userId: testatorId, capsuleId: capsule.id, action: "CAPSULE_CREATED", metadata: { type } });
  return { ...capsule, hasContent: false };
}

// Capsules this user can see in any role: as testator, guarantor, or beneficiary.
// Guarantors/beneficiaries only ever get status fields back, never encryptedContent.
async function listMyCapsules(userId) {
  const capsuleBrief = {
    select: {
      id: true,
      title: true,
      type: true,
      state: true,
      updatedAt: true,
      testator: { select: { fullName: true } },
    },
  };

  // Guarantors need the "view capsules they guarantee" permission. When it's off, we don't
  // even query those rows, and we tell the app why so it can show a message instead.
  const [guarantorBlocked] = await checkPermissions("GUARANTOR", ["capsule.view_assigned"]);

  const [asTestator, withContent, asGuarantor, asBeneficiary] = await Promise.all([
    prisma.capsule.findMany({
      where: { testatorId: userId },
      orderBy: { updatedAt: "desc" },
      select: NO_CONTENT_SELECT,
    }),
    prisma.capsule.findMany({
      where: { testatorId: userId, encryptedContent: { not: null } },
      select: { id: true },
    }),
    guarantorBlocked ? [] : prisma.capsuleGuarantor.findMany({ where: { userId }, include: { capsule: capsuleBrief } }),
    prisma.capsuleBeneficiary.findMany({ where: { userId }, include: { capsule: capsuleBrief } }),
  ]);

  const idsWithContent = new Set(withContent.map((c) => c.id));

  return {
    asTestator: asTestator.map((c) => ({ ...c, hasContent: idsWithContent.has(c.id) })),
    asGuarantor: asGuarantor.map((g) => g.capsule),
    asBeneficiary: asBeneficiary.map((b) => b.capsule),
    blocked: { guarantor: guarantorBlocked ? guarantorBlocked.message : null },
  };
}

async function getCapsuleForTestator(capsuleId, testatorId) {
  const [capsule, hasContent] = await Promise.all([
    prisma.capsule.findUnique({
      where: { id: capsuleId },
      select: {
        ...NO_CONTENT_SELECT,
        guarantors: { include: { user: USER_BRIEF } },
        beneficiaries: { include: { user: USER_BRIEF } },
        files: true,
      },
    }),
    hasStoredContent(capsuleId),
  ]);
  if (!capsule || capsule.testatorId !== testatorId) throw new ApiError(404, "Capsule not found.");
  return { ...capsule, hasContent };
}

async function getEncryptedContent(capsuleId, testatorId) {
  const capsule = await prisma.capsule.findUnique({
    where: { id: capsuleId },
    select: { testatorId: true, encryptedContent: true },
  });
  if (!capsule || capsule.testatorId !== testatorId) throw new ApiError(404, "Capsule not found.");
  return capsule.encryptedContent ? Buffer.from(capsule.encryptedContent).toString("base64") : null;
}

async function updateDraftCapsule(capsuleId, testatorId, { title, encryptedContentBase64 }) {
  await Promise.all([
    assertPermission("TESTATOR", "capsule.edit_draft"),
    getOwnedDraftCapsule(capsuleId, testatorId),
  ]);

  const data = {};
  if (title !== undefined) data.title = title;
  if (encryptedContentBase64 !== undefined) data.encryptedContent = Buffer.from(encryptedContentBase64, "base64");

  const capsule = await updateCapsule(capsuleId, data, data.encryptedContent !== undefined ? true : undefined);
  writeAuditLog({ userId: testatorId, capsuleId, action: "CAPSULE_UPDATED" });
  return capsule;
}

async function deleteDraftCapsule(capsuleId, testatorId) {
  await Promise.all([
    assertPermission("TESTATOR", "capsule.delete_draft"),
    getOwnedDraftCapsule(capsuleId, testatorId),
  ]);

  await prisma.capsule.delete({ where: { id: capsuleId } });
  writeAuditLog({ userId: testatorId, capsuleId, action: "CAPSULE_DELETED" });
}

// --- Members (guarantors / beneficiaries) ---------------------------------------

async function addGuarantor(capsuleId, testatorId, email) {
  const [, , user] = await Promise.all([
    assertPermission("TESTATOR", "capsule.manage_members"),
    getOwnedDraftCapsule(capsuleId, testatorId),
    prisma.user.findUnique({ where: { email } }),
  ]);

  if (!user) throw new ApiError(404, `No account found for ${email}. They must register first.`);
  if (user.id === testatorId) throw new ApiError(400, "You can't be your own guarantor.");

  const guarantor = await prisma.capsuleGuarantor
    .create({ data: { capsuleId, userId: user.id } })
    .catch(() => {
      throw new ApiError(409, "This person is already a guarantor on this capsule.");
    });

  notifyInBackground(createNotification(user.id, "GUARANTOR_ASSIGNED", { capsuleId }));
  writeAuditLog({ userId: testatorId, capsuleId, action: "GUARANTOR_ADDED", metadata: { guarantorId: user.id } });
  return guarantor;
}

async function removeGuarantor(capsuleId, testatorId, guarantorUserId) {
  await Promise.all([
    assertPermission("TESTATOR", "capsule.manage_members"),
    getOwnedDraftCapsule(capsuleId, testatorId),
  ]);

  await prisma.capsuleGuarantor.delete({
    where: { capsuleId_userId: { capsuleId, userId: guarantorUserId } },
  });
  writeAuditLog({ userId: testatorId, capsuleId, action: "GUARANTOR_REMOVED", metadata: { guarantorId: guarantorUserId } });
}

async function addBeneficiary(capsuleId, testatorId, email) {
  const [, , user] = await Promise.all([
    assertPermission("TESTATOR", "capsule.manage_members"),
    getOwnedDraftCapsule(capsuleId, testatorId),
    prisma.user.findUnique({ where: { email } }),
  ]);

  if (!user) throw new ApiError(404, `No account found for ${email}. They must register first.`);
  if (user.id === testatorId) throw new ApiError(400, "You can't be your own beneficiary.");

  const beneficiary = await prisma.capsuleBeneficiary
    .create({ data: { capsuleId, userId: user.id } })
    .catch(() => {
      throw new ApiError(409, "This person is already a beneficiary on this capsule.");
    });

  notifyInBackground(createNotification(user.id, "BENEFICIARY_ASSIGNED", { capsuleId }));
  writeAuditLog({ userId: testatorId, capsuleId, action: "BENEFICIARY_ADDED", metadata: { beneficiaryId: user.id } });
  return beneficiary;
}

async function removeBeneficiary(capsuleId, testatorId, beneficiaryUserId) {
  await Promise.all([
    assertPermission("TESTATOR", "capsule.manage_members"),
    getOwnedDraftCapsule(capsuleId, testatorId),
  ]);

  await Promise.all([
    prisma.capsuleBeneficiary.delete({ where: { capsuleId_userId: { capsuleId, userId: beneficiaryUserId } } }),
    // A removed beneficiary must not keep a sealed copy of the passphrase.
    prisma.capsuleKeyShare.deleteMany({ where: { capsuleId, userId: beneficiaryUserId } }),
  ]);
  writeAuditLog({ userId: testatorId, capsuleId, action: "BENEFICIARY_REMOVED", metadata: { beneficiaryId: beneficiaryUserId } });
}

// --- Thresholds & activation ------------------------------------------------------

async function setThresholds(capsuleId, testatorId, { inactivityThresholdDays, graceWindowDays, validationThreshold }) {
  await Promise.all([
    assertPermission("TESTATOR", "capsule.manage_thresholds"),
    getOwnedDraftCapsule(capsuleId, testatorId),
  ]);

  const capsule = await updateCapsule(capsuleId, { inactivityThresholdDays, graceWindowDays, validationThreshold });
  writeAuditLog({ userId: testatorId, capsuleId, action: "THRESHOLDS_UPDATED" });
  return capsule;
}

// RM3: a capsule needs >=1 beneficiary and enough guarantors to meet its own
// validation threshold before it's allowed to leave Draft.
async function activateCapsule(capsuleId, testatorId) {
  const [, capsule, guarantorCount, beneficiaryCount] = await Promise.all([
    assertPermission("TESTATOR", "capsule.activate"),
    getOwnedDraftCapsule(capsuleId, testatorId),
    prisma.capsuleGuarantor.count({ where: { capsuleId } }),
    prisma.capsuleBeneficiary.count({ where: { capsuleId } }),
  ]);

  if (beneficiaryCount < 1) throw new ApiError(400, "Add at least one beneficiary before activating (RM3).");
  if (guarantorCount < capsule.validationThreshold) {
    throw new ApiError(
      400,
      `You need at least ${capsule.validationThreshold} guarantor(s) to match your validation threshold (currently ${guarantorCount}).`
    );
  }

  const updated = await updateCapsule(capsuleId, { state: "ACTIVE", lastActivityCheckAt: new Date() });
  writeAuditLog({ userId: testatorId, capsuleId, action: "CAPSULE_ACTIVATED" });
  return updated;
}

// RM5: the testator can revoke at any point before UNLOCKED.
async function revokeCapsule(capsuleId, testatorId) {
  const [, capsule] = await Promise.all([
    assertPermission("TESTATOR", "capsule.revoke"),
    getOwnedCapsule(capsuleId, testatorId),
  ]);

  if (["UNLOCKED", "ARCHIVED", "REVOKED"].includes(capsule.state)) {
    throw new ApiError(409, "This capsule can no longer be revoked.");
  }

  const updated = await updateCapsule(
    capsuleId,
    { state: "REVOKED", revokedAt: new Date(), encryptedContent: null },
    false
  );
  writeAuditLog({ userId: testatorId, capsuleId, action: "CAPSULE_REVOKED" });

  // Let guarantors and beneficiaries know it's gone.
  notifyInBackground(
    getMemberIds(capsuleId).then(({ guarantorIds, beneficiaryIds }) =>
      notifyUsers([...guarantorIds, ...beneficiaryIds], "CAPSULE_REVOKED", { capsuleId })
    )
  );
  return updated;
}

// Testator responding to an INACTIVITY_ALERT within the grace window (Sprint 3).
async function confirmActivity(capsuleId, testatorId) {
  const [, capsule] = await Promise.all([
    assertPermission("TESTATOR", "capsule.confirm_activity"),
    getOwnedCapsule(capsuleId, testatorId),
  ]);

  if (capsule.state !== "INACTIVITY_ALERT") {
    throw new ApiError(409, "There is no active inactivity alert on this capsule.");
  }

  const [updated] = await Promise.all([
    updateCapsule(capsuleId, {
      state: "ACTIVE",
      alertSentAt: null,
      graceWindowExpiresAt: null,
      lastActivityCheckAt: new Date(),
    }),
    prisma.user.update({ where: { id: testatorId }, data: { lastSeenAt: new Date() } }),
  ]);
  writeAuditLog({ userId: testatorId, capsuleId, action: "ACTIVITY_CONFIRMED" });
  return updated;
}

// --- File attachments -------------------------------------------------------------

async function attachFile(capsuleId, testatorId, { fileName, mimeType, encryptedContentBase64 }) {
  await Promise.all([
    assertPermission("TESTATOR", "capsule.upload_file"),
    getOwnedDraftCapsule(capsuleId, testatorId),
  ]);

  const buffer = Buffer.from(encryptedContentBase64, "base64");
  const { storagePath, sizeBytes } = await uploadEncryptedFile(capsuleId, fileName, mimeType, buffer);

  const file = await prisma.capsuleFile.create({
    data: { capsuleId, fileName, mimeType, storagePath, sizeBytes },
  });
  writeAuditLog({ userId: testatorId, capsuleId, action: "FILE_ATTACHED", metadata: { fileName } });
  return file;
}

// --- Guarantor / beneficiary side --------------------------------------------------

// What a guarantor or beneficiary is allowed to see about a capsule they're named on.
// Never includes the content blob. File names only appear once it's unlocked.
async function getSharedCapsule(capsuleId, userId) {
  const [capsule, guarantorRow, beneficiaryRow, hasContent, myValidation, [guarantorBlocked], keyShare] = await Promise.all([
    prisma.capsule.findUnique({
      where: { id: capsuleId },
      select: {
        id: true,
        title: true,
        type: true,
        state: true,
        validationThreshold: true,
        validationsReceived: true,
        unlockedAt: true,
        updatedAt: true,
        testator: { select: { fullName: true } },
        files: { select: { id: true, fileName: true, mimeType: true, sizeBytes: true } },
      },
    }),
    prisma.capsuleGuarantor.findUnique({ where: { capsuleId_userId: { capsuleId, userId } } }),
    prisma.capsuleBeneficiary.findUnique({ where: { capsuleId_userId: { capsuleId, userId } } }),
    hasStoredContent(capsuleId),
    prisma.validation.findUnique({ where: { capsuleId_guarantorId: { capsuleId, guarantorId: userId } } }),
    checkPermissions("GUARANTOR", ["capsule.view_assigned"]),
    prisma.capsuleKeyShare.findUnique({ where: { capsuleId_userId: { capsuleId, userId } }, select: { id: true } }),
  ]);

  if (!capsule || (!guarantorRow && !beneficiaryRow)) throw new ApiError(404, "Capsule not found.");

  // The guarantor role only counts while "view capsules they guarantee" is enabled.
  const isGuarantor = !!guarantorRow && !guarantorBlocked;
  const isBeneficiary = !!beneficiaryRow;
  if (!isGuarantor && !isBeneficiary) throw new ApiError(403, guarantorBlocked.message);
  const unlocked = ["UNLOCKED", "ARCHIVED"].includes(capsule.state);

  return {
    id: capsule.id,
    title: capsule.title,
    type: capsule.type,
    state: capsule.state,
    testatorName: capsule.testator.fullName,
    validationThreshold: capsule.validationThreshold,
    validationsReceived: capsule.validationsReceived,
    unlockedAt: capsule.unlockedAt,
    roles: { guarantor: isGuarantor, beneficiary: isBeneficiary },
    hasValidated: !!myValidation,
    canValidate: isGuarantor && capsule.state === "PENDING_VALIDATION" && !myValidation,
    hasContent,
    canViewContent: isBeneficiary && unlocked && hasContent,
    hasKeyShare: isBeneficiary && unlocked && !!keyShare,
    files: isBeneficiary && unlocked ? capsule.files : [],
  };
}

// A guarantor confirms the testator can no longer manage the capsule. Once enough
// guarantors have done so (validationThreshold), the capsule unlocks (RM10).
async function validateCapsule(capsuleId, userId) {
  const [, guarantorRow, capsule] = await Promise.all([
    assertPermission("GUARANTOR", "validation.submit"),
    prisma.capsuleGuarantor.findUnique({ where: { capsuleId_userId: { capsuleId, userId } } }),
    prisma.capsule.findUnique({
      where: { id: capsuleId },
      select: { id: true, state: true, testatorId: true },
    }),
  ]);

  if (!guarantorRow || !capsule) throw new ApiError(404, "Capsule not found.");
  if (capsule.state !== "PENDING_VALIDATION") {
    throw new ApiError(409, "This capsule isn't waiting for validation.");
  }

  let result;
  try {
    result = await prisma.$transaction(async (tx) => {
      // RM6: unique(capsuleId, guarantorId) makes a double validation fail here.
      await tx.validation.create({ data: { capsuleId, guarantorId: userId } });

      const updated = await tx.capsule.update({
        where: { id: capsuleId },
        data: { validationsReceived: { increment: 1 } },
        select: { validationsReceived: true, validationThreshold: true },
      });

      let unlocked = false;
      if (updated.validationsReceived >= updated.validationThreshold) {
        // updateMany + state filter => only ONE concurrent request can perform the unlock.
        const { count } = await tx.capsule.updateMany({
          where: { id: capsuleId, state: "PENDING_VALIDATION" },
          data: { state: "UNLOCKED", unlockedAt: new Date() },
        });
        unlocked = count === 1;
      }
      return { ...updated, unlocked };
    });
  } catch (err) {
    if (err.code === "P2002") throw new ApiError(409, "You've already validated this capsule.");
    throw err;
  }

  writeAuditLog({
    userId,
    capsuleId,
    action: result.unlocked ? "CAPSULE_UNLOCKED" : "VALIDATION_SUBMITTED",
    metadata: { received: result.validationsReceived, required: result.validationThreshold },
  });

  notifyInBackground(
    (async () => {
      if (result.unlocked) {
        const { beneficiaryIds } = await getMemberIds(capsuleId);
        await Promise.all([
          notifyUsers(beneficiaryIds, "CAPSULE_UNLOCKED", { capsuleId, audience: "BENEFICIARY" }),
          createNotification(capsule.testatorId, "CAPSULE_UNLOCKED", { capsuleId, audience: "TESTATOR" }),
        ]);
      } else {
        await createNotification(capsule.testatorId, "VALIDATION_RECEIVED", {
          capsuleId,
          received: result.validationsReceived,
          required: result.validationThreshold,
        });
      }
    })()
  );

  return {
    validationsReceived: result.validationsReceived,
    validationThreshold: result.validationThreshold,
    unlocked: result.unlocked,
  };
}

// Encrypted content for a beneficiary. Only released once the capsule is UNLOCKED
// (or ARCHIVED, i.e. already read once). The server still can't read it - the
// beneficiary needs the testator's passphrase to decrypt it on their device.
async function getSharedContent(capsuleId, userId) {
  const [, capsule, beneficiary] = await Promise.all([
    assertPermission("BENEFICIARY", "capsule.view_unlocked"),
    prisma.capsule.findUnique({ where: { id: capsuleId }, select: { id: true, testatorId: true, state: true } }),
    prisma.capsuleBeneficiary.findUnique({ where: { capsuleId_userId: { capsuleId, userId } } }),
  ]);

  if (!capsule || !beneficiary) throw new ApiError(404, "Capsule not found.");

  if (!["UNLOCKED", "ARCHIVED"].includes(capsule.state)) {
    if (
      ["ACTIVE", "INACTIVITY_ALERT", "PENDING_VALIDATION"].includes(capsule.state) &&
      shouldNotifyAttempt(`${capsuleId}:${userId}`)
    ) {
      notifyInBackground(createNotification(capsule.testatorId, "CAPSULE_ACCESS_ATTEMPT", { capsuleId }));
      writeAuditLog({ userId, capsuleId, action: "ACCESS_ATTEMPT_BLOCKED", metadata: { state: capsule.state } });
    }
    throw new ApiError(403, "This capsule is still locked.");
  }

  const row = await prisma.capsule.findUnique({ where: { id: capsuleId }, select: { encryptedContent: true } });

  // Archiving does NOT happen here: delivering bytes isn't a "read". It happens in
  // confirmFirstRead(), once the beneficiary's device confirms it decrypted the content.
  writeAuditLog({ userId, capsuleId, action: "CAPSULE_CONTENT_ACCESSED" });

  return row?.encryptedContent ? Buffer.from(row.encryptedContent).toString("base64") : null;
}

// The beneficiary's device calls this after decrypting successfully. The FIRST confirmation
// archives the capsule (RM10: UNLOCKED -> ARCHIVED). Reading stays unlimited afterwards.
async function confirmFirstRead(capsuleId, userId) {
  const [, capsule, beneficiary] = await Promise.all([
    assertPermission("BENEFICIARY", "capsule.view_unlocked"),
    prisma.capsule.findUnique({ where: { id: capsuleId }, select: { state: true } }),
    prisma.capsuleBeneficiary.findUnique({ where: { capsuleId_userId: { capsuleId, userId } } }),
  ]);

  if (!capsule || !beneficiary) throw new ApiError(404, "Capsule not found.");
  if (!["UNLOCKED", "ARCHIVED"].includes(capsule.state)) throw new ApiError(403, "This capsule is still locked.");

  let archivedNow = false;
  if (!beneficiary.firstAccessedAt) {
    const now = new Date();
    const [, { count }] = await Promise.all([
      prisma.capsuleBeneficiary.update({
        where: { capsuleId_userId: { capsuleId, userId } },
        data: { firstAccessedAt: now },
      }),
      // The state filter makes sure only one request can perform the transition.
      prisma.capsule.updateMany({
        where: { id: capsuleId, state: "UNLOCKED" },
        data: { state: "ARCHIVED", archivedAt: now },
      }),
    ]);
    archivedNow = count === 1;
    writeAuditLog({ userId, capsuleId, action: "CAPSULE_FIRST_ACCESS" });
    if (archivedNow) writeAuditLog({ userId, capsuleId, action: "CAPSULE_ARCHIVED" });
  }

  return { archived: archivedNow || capsule.state === "ARCHIVED" };
}

// Short-lived signed link to an attachment's ENCRYPTED bytes. Only released for an unlocked
// capsule, to one of its beneficiaries. The file is decrypted on the beneficiary's device.
async function getSharedFileUrl(capsuleId, fileId, userId) {
  const [, capsule, beneficiary, file] = await Promise.all([
    assertPermission("BENEFICIARY", "capsule.view_unlocked"),
    prisma.capsule.findUnique({ where: { id: capsuleId }, select: { state: true } }),
    prisma.capsuleBeneficiary.findUnique({ where: { capsuleId_userId: { capsuleId, userId } } }),
    prisma.capsuleFile.findFirst({ where: { id: fileId, capsuleId } }),
  ]);

  if (!capsule || !beneficiary || !file) throw new ApiError(404, "File not found.");
  if (!["UNLOCKED", "ARCHIVED"].includes(capsule.state)) throw new ApiError(403, "This capsule is still locked.");

  const url = await getSignedDownloadUrl(file.storagePath, 300);
  writeAuditLog({ userId, capsuleId, action: "FILE_DOWNLOADED", metadata: { fileId, fileName: file.fileName } });
  return { url, fileName: file.fileName, mimeType: file.mimeType };
}

module.exports = {
  createCapsule,
  listMyCapsules,
  getCapsuleForTestator,
  getEncryptedContent,
  updateDraftCapsule,
  deleteDraftCapsule,
  addGuarantor,
  removeGuarantor,
  addBeneficiary,
  removeBeneficiary,
  setThresholds,
  activateCapsule,
  revokeCapsule,
  confirmActivity,
  attachFile,
  getSharedCapsule,
  validateCapsule,
  getSharedContent,
  confirmFirstRead,
  getSharedFileUrl,
};
