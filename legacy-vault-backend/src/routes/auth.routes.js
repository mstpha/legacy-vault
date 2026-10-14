const express = require("express");
const controller = require("../controllers/auth.controller");
const { requireAuth } = require("../middleware/requireAuth");
const { authLimiter } = require("../middleware/rateLimiter");
const {
  registerSchema,
  loginSchema,
  mfaTokenSchema,
  refreshSchema,
  validate,
} = require("../utils/validators");

const router = express.Router();

router.post("/register", authLimiter, validate(registerSchema), controller.register);
router.post("/login", authLimiter, validate(loginSchema), controller.login);
router.post("/refresh", authLimiter, validate(refreshSchema), controller.refresh);
router.post("/logout", requireAuth, validate(refreshSchema), controller.logout);
router.post("/verify-email", authLimiter, controller.verifyEmail);

// MFA enrollment: user must already be logged in (with a valid access token) to enroll.
router.post("/mfa/setup", requireAuth, authLimiter, controller.beginMfaEnrollment);
router.post("/mfa/confirm", requireAuth, authLimiter, validate(mfaTokenSchema), controller.confirmMfaEnrollment);
router.post("/mfa/disable", requireAuth, authLimiter, validate(mfaTokenSchema), controller.disableMfa);

router.get("/me", requireAuth, controller.me);

module.exports = router;
