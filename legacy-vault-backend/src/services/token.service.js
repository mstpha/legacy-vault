const jwt = require("jsonwebtoken");
const prisma = require("../config/db");
const { hashToken, generateOpaqueToken } = require("../utils/password");

function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, mfaEnabled: user.mfaEnabled },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || "15m" }
  );
}

function verifyAccessToken(token) {
  return jwt.verify(token, process.env.JWT_ACCESS_SECRET);
}

function refreshTtlMs() {
  // e.g. "30d" -> 30 * 86400000. Keep it simple: only days/hours/minutes supported here.
  const raw = process.env.JWT_REFRESH_EXPIRES_IN || "30d";
  const match = /^(\d+)([dhm])$/.exec(raw);
  if (!match) return 30 * 24 * 60 * 60 * 1000;
  const value = Number(match[1]);
  const unit = { d: 86400000, h: 3600000, m: 60000 }[match[2]];
  return value * unit;
}

// Issues a new opaque refresh token, stores only its hash, returns the raw token to the caller.
async function issueRefreshToken(userId, { ip, userAgent } = {}) {
  const raw = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + refreshTtlMs());

  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: hashToken(raw),
      expiresAt,
      createdByIp: ip,
      userAgent,
    },
  });

  return raw;
}

// Validates a raw refresh token, rotates it (revokes the old row, issues a new one),
// and returns { userId, newRawToken }. Throws if the token is invalid, expired, or reused.
async function rotateRefreshToken(rawToken, meta = {}) {
  const tokenHash = hashToken(rawToken);
  const existing = await prisma.refreshToken.findUnique({ where: { tokenHash } });

  if (!existing || existing.revokedAt || existing.expiresAt < new Date()) {
    // Reuse of a revoked/expired token is a strong theft signal.
    // Sprint 5 hardening: revoke the whole token family for this user here.
    const err = new Error("Invalid or expired refresh token");
    err.statusCode = 401;
    throw err;
  }

  const newRaw = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + refreshTtlMs());

  await prisma.$transaction([
    prisma.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date(), replacedByToken: hashToken(newRaw) },
    }),
    prisma.refreshToken.create({
      data: {
        userId: existing.userId,
        tokenHash: hashToken(newRaw),
        expiresAt,
        createdByIp: meta.ip,
        userAgent: meta.userAgent,
      },
    }),
  ]);

  return { userId: existing.userId, newRawToken: newRaw };
}

async function revokeRefreshToken(rawToken) {
  const tokenHash = hashToken(rawToken);
  await prisma.refreshToken.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

module.exports = {
  signAccessToken,
  verifyAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
};
