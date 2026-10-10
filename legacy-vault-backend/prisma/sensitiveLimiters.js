const rateLimit = require("express-rate-limit");
const { ApiError } = require("./errorHandler");

// Rate limiting for the sensitive capsule endpoints (Sprint 5). Login/register/refresh/MFA
// already use authLimiter. These routes all sit behind requireAuth, so the limit is per
// signed-in user (not per IP), which is fairer behind shared networks and can't be dodged
// by switching IPs. Counters live in memory and reset on restart; for several server
// instances, back them with Redis (rate-limit-redis) instead.
function makeLimiter({ max, windowMinutes, message }) {
  return rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    limit: max, // express-rate-limit v7+
    max, // express-rate-limit v6 (ignored by newer versions)
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.user?.sub || "anonymous",
    // Goes through your errorHandler, so the app receives the usual { error: { message } }.
    handler: (req, res, next) => next(new ApiError(429, message)),
  });
}

// A guarantor's vote can be cast once per capsule; this stops scripted hammering (the
// request that reaches the threshold is what unlocks the capsule).
const validationLimiter = makeLimiter({
  max: 10,
  windowMinutes: 15,
  message: "Too many validation attempts. Please wait a few minutes and try again.",
});

// Opening an unlocked capsule: content and file downloads.
const unlockLimiter = makeLimiter({
  max: 30,
  windowMinutes: 15,
  message: "Too many attempts to open this capsule. Please wait a few minutes and try again.",
});

// Registering / replacing / removing a device key (account-takeover attackers would try to swap it).
const keyChangeLimiter = makeLimiter({
  max: 10,
  windowMinutes: 60,
  message: "Too many device key changes. Please try again later.",
});

module.exports = { validationLimiter, unlockLimiter, keyChangeLimiter };
