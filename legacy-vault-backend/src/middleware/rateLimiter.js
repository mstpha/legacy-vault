const rateLimit = require("express-rate-limit");

// Sprint 1 scope: in-memory store is fine for a single instance.
// Swap the `store` option for a RedisStore (rate-limit-redis) once you run
// more than one API instance — the package is already in package.json.
const authLimiter = rateLimit({
  windowMs: 30 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts / window / IP on login, register, MFA verify
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: "Too many attempts, please try again later." } },
});

module.exports = { authLimiter };
