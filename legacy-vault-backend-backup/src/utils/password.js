const bcrypt = require("bcrypt");
const crypto = require("crypto");

const SALT_ROUNDS = 12;

async function hashPassword(plain) {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

// Refresh tokens are long random strings; we only ever store a SHA-256 hash
// of them (bcrypt is unnecessarily slow for a value this high-entropy).
function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function generateOpaqueToken() {
  return crypto.randomBytes(48).toString("hex");
}

module.exports = { hashPassword, verifyPassword, hashToken, generateOpaqueToken };
