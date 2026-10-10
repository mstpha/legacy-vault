const crypto = require("crypto");
const prisma = require("../config/db");
const { ApiError } = require("../middleware/errorHandler");
const { assertPermission } = require("./permissions.service");
const { writeAuditLog } = require("./audit.service");

// Per-person device keys (X25519).
//
// Each user's phone generates a key pair. The PRIVATE key never leaves the phone. Only the
// PUBLIC key is sent here. A capsule owner can then "seal" the capsule passphrase to a
// beneficiary's public key on the owner's own phone, and upload just the sealed blob. The
// server stores and returns it, but cannot open it: only the beneficiary's private key can.

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const SEALED_OVERHEAD = 32 + 24 + 16; // ephemeral public key + nonce + auth tag
const SEALED_MAX_BYTES = 1024;
const LOCKED_STATES = ["UNLOCKED", "ARCHIVED"];

function decodeBase64(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.length > 4096 || value.length % 4 !== 0 || !BASE64.test(value)) {
    throw new ApiError(400, `${label} must be valid base64.`);
  }
  return Buffer.from(value, "base64");
}

function validatePublicKey(value) {
  if (decodeBase64(value, "publicKey").length !== 32) throw new ApiError(400, "publicKey must be a 32-byte X25519 key.");
  return value;
}

function validateWrappedKey(value) {
  const length = decodeBase64(value, "wrappedKey").length;
  if (length <= SEALED_OVERHEAD || length > SEALED_MAX_BYTES) throw new ApiError(400, "wrappedKey has an invalid size.");
  return value;
}

// Short human-comparable digest of a public key (same algorithm as the app: SHA-512, first 10 bytes).
function fingerprintOf(publicKey) {
  return crypto.createHash("sha512").update(Buffer.from(publicKey, "base64")).digest("hex").slice(0, 20).toUpperCase();
}

// --- The signed-in user's own key ---------------------------------------------------

async function getMyKey(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { publicKey: true, publicKeyUpdatedAt: true },
  });
  if (!user) throw new ApiError(404, "User not found.");
  return { publicKey: user.publicKey, updatedAt: user.publicKeyUpdatedAt };
}

// Registers (or replaces) the public key. Replacing it deletes every share sealed to the
// old key, since they could never be opened again, and the owners must re-share.
async function registerPublicKey(userId, publicKey) {
  validatePublicKey(publicKey);

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { publicKey: true } });
  if (!user) throw new ApiError(404, "User not found.");
  if (user.publicKey === publicKey) return { publicKey, changed: false };

  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { publicKey, publicKeyUpdatedAt: new Date() } }),
    prisma.capsuleKeyShare.deleteMany({ where: { userId } }),
  ]);

  writeAuditLog({
    userId,
    action: user.publicKey ? "PUBLIC_KEY_CHANGED" : "PUBLIC_KEY_REGISTERED",
    metadata: { fingerprint: fingerprintOf(publicKey) },
  });
  return { publicKey, changed: true };
}

async function removePublicKey(userId) {
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { publicKey: null, publicKeyUpdatedAt: null } }),
    prisma.capsuleKeyShare.deleteMany({ where: { userId } }),
  ]);
  writeAuditLog({ userId, action: "PUBLIC_KEY_REMOVED" });
}

// --- Owner side -------------------------------------------------------------------------

async function getOwnedCapsuleState(capsuleId, ownerId) {
  const capsule = await prisma.capsule.findUnique({ where: { id: capsuleId }, select: { testatorId: true, state: true } });
  if (!capsule || capsule.testatorId !== ownerId) throw new ApiError(404, "Capsule not found.");
  return capsule;
}

// Beneficiaries of the capsule, with the public key the owner's phone needs for sealing.
async function listKeyRecipients(capsuleId, ownerId) {
  const [capsule, beneficiaries, shares] = await Promise.all([
    getOwnedCapsuleState(capsuleId, ownerId),
    prisma.capsuleBeneficiary.findMany({
      where: { capsuleId },
      select: { user: { select: { id: true, fullName: true, email: true, publicKey: true } } },
    }),
    prisma.capsuleKeyShare.findMany({ where: { capsuleId }, select: { userId: true } }),
  ]);

  const shared = new Set(shares.map((s) => s.userId));
  return {
    state: capsule.state,
    recipients: beneficiaries.map(({ user }) => ({
      userId: user.id,
      fullName: user.fullName,
      email: user.email,
      publicKey: user.publicKey,
      hasShare: shared.has(user.id),
    })),
  };
}

// shares: [{ userId, publicKey, wrappedKey }]. publicKey is the key the owner sealed TO: if the
// recipient has replaced their key in the meantime the share would be unreadable, so refuse.
async function saveKeyShares(capsuleId, ownerId, shares) {
  const [, capsule] = await Promise.all([
    assertPermission("TESTATOR", "capsule.manage_members"),
    getOwnedCapsuleState(capsuleId, ownerId),
  ]);
  if (["UNLOCKED", "ARCHIVED", "REVOKED"].includes(capsule.state)) {
    throw new ApiError(409, "Keys can't be shared once a capsule is unlocked or revoked.");
  }

  if (!Array.isArray(shares) || shares.length === 0 || shares.length > 50) {
    throw new ApiError(400, "shares must be a list of 1 to 50 entries.");
  }
  const seen = new Set();
  for (const share of shares) {
    if (!share || typeof share.userId !== "string" || seen.has(share.userId)) throw new ApiError(400, "Each share needs a unique userId.");
    seen.add(share.userId);
    validatePublicKey(share.publicKey);
    validateWrappedKey(share.wrappedKey);
  }

  const members = await prisma.capsuleBeneficiary.findMany({
    where: { capsuleId, userId: { in: [...seen] } },
    select: { userId: true, user: { select: { publicKey: true } } },
  });
  const keyByUser = new Map(members.map((m) => [m.userId, m.user.publicKey]));

  for (const share of shares) {
    if (!keyByUser.has(share.userId)) throw new ApiError(400, "Keys can only be shared with this capsule's beneficiaries.");
    if (keyByUser.get(share.userId) !== share.publicKey) {
      throw new ApiError(409, "A recipient changed their device key. Reload and review the fingerprints before sharing again.");
    }
  }

  await prisma.$transaction(
    shares.map((s) =>
      prisma.capsuleKeyShare.upsert({
        where: { capsuleId_userId: { capsuleId, userId: s.userId } },
        create: { capsuleId, userId: s.userId, wrappedKey: s.wrappedKey },
        update: { wrappedKey: s.wrappedKey },
      })
    )
  );

  writeAuditLog({ userId: ownerId, capsuleId, action: "KEY_SHARES_UPDATED", metadata: { count: shares.length } });
  return { saved: shares.length };
}

// --- Beneficiary side -------------------------------------------------------------------

// The sealed blob, only once the capsule is unlocked. Useless without the device's private key.
async function getKeyShareForBeneficiary(capsuleId, userId) {
  const [, capsule, beneficiary, share] = await Promise.all([
    assertPermission("BENEFICIARY", "capsule.view_unlocked"),
    prisma.capsule.findUnique({ where: { id: capsuleId }, select: { state: true } }),
    prisma.capsuleBeneficiary.findUnique({ where: { capsuleId_userId: { capsuleId, userId } } }),
    prisma.capsuleKeyShare.findUnique({ where: { capsuleId_userId: { capsuleId, userId } } }),
  ]);

  if (!capsule || !beneficiary) throw new ApiError(404, "Capsule not found.");
  if (!LOCKED_STATES.includes(capsule.state)) throw new ApiError(403, "This capsule is still locked.");
  if (!share) throw new ApiError(404, "No device key was shared with you for this capsule.");

  writeAuditLog({ userId, capsuleId, action: "KEY_SHARE_DELIVERED" });
  return { wrappedKey: share.wrappedKey };
}

module.exports = {
  getMyKey,
  registerPublicKey,
  removePublicKey,
  listKeyRecipients,
  saveKeyShares,
  getKeyShareForBeneficiary,
  validatePublicKey,
  validateWrappedKey,
  fingerprintOf,
};
