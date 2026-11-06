const rateLimit = require("express-rate-limit");

// In-memory store: fine for a single instance. For several API instances swap the `store` option
// for a RedisStore (rate-limit-redis) so the counters are shared.
//
// Sprint 6: the window really is 30 minutes (the old comment said 15). Limits are now configurable
// through env vars so e2e/load tests can raise them without touching production defaults.
const WINDOW_MS = Number(process.env.AUTH_RATE_WINDOW_MINUTES || 30) * 60 * 1000;

const authLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: Number(process.env.AUTH_RATE_MAX || 10), // attempts / window / IP on login, register, verify-email, MFA
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: "Too many attempts, please try again later." } },
});

// /auth/refresh is called automatically by the app (every access-token expiry, from every device
// behind the same NAT), so sharing the strict login budget would lock real users out.
const refreshLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: Number(process.env.REFRESH_RATE_MAX || 60),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: "Too many attempts, please try again later." } },
});

module.exports = { authLimiter, refreshLimiter };
