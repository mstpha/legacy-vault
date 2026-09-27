const { authenticator } = require("otplib");
const QRCode = require("qrcode");
const logger = require("../config/logger");

// TOTP codes are time-based: a 30s step window is standard, but real devices
// (and dev machines) often drift by more than that. window: 2 accepts codes
// from up to 2 steps (±60s) on either side, which is the usual fix for
// "my code is definitely right but it says invalid" caused by clock skew.
authenticator.options = { window: 2 };

function generateSecret() {
  return authenticator.generateSecret();
}

function verifyToken(token, secret) {
  const isValid = authenticator.verify({ token, secret });
  if (!isValid) {
    // Never log the secret or the code itself — just enough to diagnose
    // clock-drift issues (compare serverTime against the device's clock).
    logger.warn("TOTP verification failed", { serverTime: new Date().toISOString() });
  }
  return isValid;
}

async function generateQrCodeDataUrl(email, secret) {
  const issuer = process.env.MFA_ISSUER || "Digital Legacy Vault";
  const otpauthUrl = authenticator.keyuri(email, issuer, secret);
  return QRCode.toDataURL(otpauthUrl);
}

module.exports = { generateSecret, verifyToken, generateQrCodeDataUrl };