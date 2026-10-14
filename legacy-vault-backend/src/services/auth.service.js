const prisma = require("../config/db");
const logger = require("../config/logger");
const crypto = require("crypto");
const { renderEmail } = require("../utils/emailTemplate");
const { sendEmail } = require("../config/mailer");
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
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedName = String(fullName || "").trim();

  if (!normalizedEmail || !password || !normalizedName) {
    throw new ApiError(400, "Name, email, and password are required.");
  }

  const existingUser = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (existingUser) {
    throw new ApiError(409, "An account with this email already exists.");
  }

  const passwordHash = await hashPassword(password);
  const code = crypto.randomInt(100000, 1000000).toString();
  const emailVerificationCodeHash = await hashPassword(code);
  const emailVerificationExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

  const user = await prisma.user.create({
    data: {
      email: normalizedEmail,
      passwordHash,
      fullName: normalizedName,
      emailVerified: false,
      emailVerificationCodeHash,
      emailVerificationExpiresAt,
      emailVerificationAttempts: 0,
    },
  });

  const { html, text } = renderEmail({
    recipientName: normalizedName,
    title: "Verify your email address",
    message: `Your Digital Legacy Vault verification code is ${code}. It expires in 10 minutes. If you did not create this account, you can ignore this email.`,
    tone: "info",
  });

  const delivery = await sendEmail({
    to: normalizedEmail,
    subject: "Verify your Digital Legacy Vault email",
    html,
    text,
    category: "Email Verification",
  });

  if (!delivery?.sent) {
    // Keep the account so the user can request another code later.
    throw new ApiError(
      503,
      "Your account was created, but the verification email could not be sent. Please request a new code."
    );
  }

  return {
    message: "Account created. Check your email for the six-digit verification code.",
    email: normalizedEmail,
  };
}


async function login({ email, password, mfaToken }, meta) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    throw new ApiError(401, "Invalid email or password.");
  }

  if (!user.emailVerified) {
    await sendVerificationCode(user);
    throw new ApiError(
      403,
      "EMAIL_NOT_VERIFIED"
    );
  }

  if (user.mfaEnabled) {
    if (!mfaToken) {
      // Signal the client to prompt for the TOTP code, without issuing any tokens yet.
      return { mfaRequired: true };
    }
    if (!verifyToken(mfaToken, user.mfaSecret)) {
      writeAuditLog({ userId: user.id, action: "MFA_LOGIN_REJECTED" });
      throw new ApiError(401, "Invalid MFA code.");
    }
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date(), lastSeenAt: new Date() },
  });

  const accessToken = signAccessToken(user);
  const refreshToken = await issueRefreshToken(user.id, meta);

  writeAuditLog({ userId: user.id, action: "USER_LOGGED_IN", metadata: { ip: meta.ip } });

  return { user: sanitizeUser(user), accessToken, refreshToken, mfaRequired: false };
}




async function verifyEmail({ email, code }) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedCode = String(code || "").trim();

  if (!normalizedEmail || !/^\d{6}$/.test(normalizedCode)) {
    throw new ApiError(400, "Enter a valid six-digit verification code.");
  }

  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (!user || user.emailVerified) {
    throw new ApiError(400, "Invalid or expired verification code.");
  }

  if (
    !user.emailVerificationCodeHash ||
    !user.emailVerificationExpiresAt ||
    user.emailVerificationExpiresAt <= new Date() ||
    user.emailVerificationAttempts >= 5
  ) {
    throw new ApiError(400, "Invalid or expired verification code.");
  }

  // Use your existing password verification helper.
  const validCode = await verifyPassword(
    normalizedCode,
    user.emailVerificationCodeHash
  );

  if (!validCode) {
    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerificationAttempts: { increment: 1 } },
    });

    throw new ApiError(400, "Invalid or expired verification code.");
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      emailVerified: true,
      emailVerificationCodeHash: null,
      emailVerificationExpiresAt: null,
      emailVerificationAttempts: 0,
    },
  });

  // If your project uses audit logging, record EMAIL_VERIFIED here.

  return { message: "Email verified successfully. You can now log in." };
}

async function sendVerificationCode(user) {
  const crypto = require("crypto");

  const code = crypto.randomInt(100000, 1000000).toString();
  const codeHash = await hashPassword(code);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      emailVerified: false,
      emailVerificationCodeHash: codeHash,
      emailVerificationExpiresAt: expiresAt,
      emailVerificationAttempts: 0,
    },
  });

  const { html, text } = renderEmail({
    recipientName: user.fullName,
    title: "Verify your email address",
    message: `Your Digital Legacy Vault verification code is ${code}. It expires in 10 minutes.`,
    tone: "info",
  });

  const delivery = await sendEmail({
    to: user.email,
    subject: "Verify your Digital Legacy Vault email",
    html,
    text,
    category: "Email Verification",
  });

  if (!delivery?.sent) {
    throw new ApiError(
      503,
      "We couldn't send your verification email. Please try again."
    );
  }

  return {
    message: "A new verification code has been sent to your email.",
    email: user.email,
  };
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
  writeAuditLog({ userId, action: "MFA_ENABLED" });

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
  writeAuditLog({ userId, action: "MFA_DISABLED" });

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
  writeAuditLog({ userId, action: "USER_LOGGED_OUT" });
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
  verifyEmail,
  login,
  beginMfaEnrollment,
  confirmMfaEnrollment,
  disableMfaEnrollment,
  refresh,
  logout,
  getProfile,
};
