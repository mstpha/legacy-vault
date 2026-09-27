const prisma = require("../config/db");
const logger = require("../config/logger");
const { hashPassword, verifyPassword } = require("../utils/password");
const { generateSecret, verifyToken, generateQrCodeDataUrl } = require("./mfa.service");
const {
  signAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
} = require("./token.service");
const { ApiError } = require("../middleware/errorHandler");

async function writeAuditLog({ userId, action, metadata }) {
  // Sprint 1: plain insert. Hash-chaining (prevHash/hash) is added in Sprint 5.
  await prisma.auditLog.create({ data: { userId, action, metadata } }).catch((err) => {
    // Audit logging must never block the primary flow, but it must be loud if it fails.
    logger.error("Failed to write audit log", { action, err: err.message });
  });
}

async function register({ email, password, fullName }) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new ApiError(409, "An account with this email already exists.");

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: { email, passwordHash, fullName },
  });

  await writeAuditLog({ userId: user.id, action: "USER_REGISTERED" });
  return sanitizeUser(user);
}

async function login({ email, password, mfaToken }, meta) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    throw new ApiError(401, "Invalid email or password.");
  }

  if (user.mfaEnabled) {
    if (!mfaToken) {
      // Signal the client to prompt for the TOTP code, without issuing any tokens yet.
      return { mfaRequired: true };
    }
    if (!verifyToken(mfaToken, user.mfaSecret)) {
      await writeAuditLog({ userId: user.id, action: "MFA_LOGIN_REJECTED" });
      throw new ApiError(401, "Invalid MFA code.");
    }
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date(), lastSeenAt: new Date() },
  });

  const accessToken = signAccessToken(user);
  const refreshToken = await issueRefreshToken(user.id, meta);

  await writeAuditLog({ userId: user.id, action: "USER_LOGGED_IN", metadata: { ip: meta.ip } });

  return { user: sanitizeUser(user), accessToken, refreshToken, mfaRequired: false };
}

// Step 1: generate + persist a secret (not yet "enabled"), return the QR code to scan.
async function beginMfaEnrollment(userId) {
  const existing = await prisma.user.findUnique({ where: { id: userId } });
  if (existing.mfaEnabled) {
    // Regenerating the secret here would silently invalidate the code in the
    // user's authenticator app while mfaEnabled stays true — every future
    // verification (including disable) would then fail against the new,
    // never-scanned secret. Disable first, then re-enroll.
    throw new ApiError(400, "MFA is already enabled. Disable it before re-enrolling.");
  }

  const secret = generateSecret();
  await prisma.user.update({ where: { id: userId }, data: { mfaSecret: secret } });

  const user = await prisma.user.findUnique({ where: { id: userId } });
  const qrCodeDataUrl = await generateQrCodeDataUrl(user.email, secret);
  return { secret, qrCodeDataUrl };
}

// Step 2: user proves they scanned it correctly before we flip mfaEnabled on.
async function confirmMfaEnrollment(userId, token) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user.mfaSecret) throw new ApiError(400, "MFA enrollment was not started.");
  if (!verifyToken(token, user.mfaSecret)) throw new ApiError(400, "Invalid MFA code.");

  const updated = await prisma.user.update({ where: { id: userId }, data: { mfaEnabled: true } });
  await writeAuditLog({ userId, action: "MFA_ENABLED" });

  // Reissue the access token so its mfaEnabled claim is correct immediately,
  // instead of staying stale until the next /refresh.
  const accessToken = signAccessToken(updated);
  return { mfaEnabled: true, accessToken };
}

// Reissue the access token so its mfaEnabled claim is correct immediately,
// instead of staying stale until the next /refresh.
async function disableMfaEnrollment(userId, token) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user.mfaEnabled) throw new ApiError(400, "MFA is not currently enabled.");
  // Require a valid current code before turning MFA off — otherwise a stolen
  // access token alone would be enough to strip protection off the account.
  if (!verifyToken(token, user.mfaSecret)) throw new ApiError(400, "Invalid MFA code.");

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { mfaEnabled: false, mfaSecret: null },
  });
  await writeAuditLog({ userId, action: "MFA_DISABLED" });

  const accessToken = signAccessToken(updated);
  return { mfaEnabled: false, accessToken };
}

async function refresh(rawRefreshToken, meta) {
  const { userId, newRawToken } = await rotateRefreshToken(rawRefreshToken, meta);
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new ApiError(401, "User no longer exists.");

  const accessToken = signAccessToken(user);
  return { accessToken, refreshToken: newRawToken };
}

// Always reads the live row — never trust mfaEnabled (or anything else) off the
// JWT's claims, since the token was signed at login/refresh time and goes stale
// the moment something like MFA enrollment changes in between.
async function getMe(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new ApiError(404, "User not found.");
  return sanitizeUser(user);
}

async function logout(rawRefreshToken, userId) {
  await revokeRefreshToken(rawRefreshToken);
  await writeAuditLog({ userId, action: "USER_LOGGED_OUT" });
}

// The access token's claims (including mfaEnabled) are a snapshot from whenever it was
// issued. Enabling MFA mid-session doesn't invalidate the token, so anything that needs
// the *current* mfaEnabled value (like the profile screen) must re-read it from the DB
// rather than trusting req.user off the decoded JWT.
async function getProfile(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new ApiError(404, "User not found.");
  return sanitizeUser(user);
}

function sanitizeUser(user) {
  const { passwordHash, mfaSecret, ...safe } = user;
  return safe;
}

module.exports = {
  register,
  login,
  beginMfaEnrollment,
  confirmMfaEnrollment,
  disableMfaEnrollment,
  refresh,
  logout,
  getProfile,
};