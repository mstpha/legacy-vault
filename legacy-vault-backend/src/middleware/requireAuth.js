const prisma = require("../config/db");
const logger = require("../config/logger");
const { verifyAccessToken } = require("../services/token.service");
const { ApiError } = require("./errorHandler");

// RM4 (inactivity detection) is driven by users.lastSeenAt. The schema comment promised it is
// refreshed on every authenticated request, but until Sprint 6 it was only written at login and on
// confirm-activity: a testator using the app daily (access token refreshed, no new login) looked
// inactive and could be pushed towards INACTIVITY_ALERT / PENDING_VALIDATION while alive.
// We refresh it at most once per interval per user, so the cost is one tiny UPDATE per user per 5 min.
const TOUCH_INTERVAL_MS = Number(process.env.LAST_SEEN_TOUCH_INTERVAL_MS || 5 * 60 * 1000);
const MAX_TRACKED_USERS = 10000;
const lastTouched = new Map();

function touchLastSeen(userId) {
  const now = Date.now();
  if (now - (lastTouched.get(userId) || 0) < TOUCH_INTERVAL_MS) return;

  if (lastTouched.size >= MAX_TRACKED_USERS) {
    for (const [id, at] of lastTouched) if (now - at >= TOUCH_INTERVAL_MS) lastTouched.delete(id);
  }
  lastTouched.set(userId, now);

  // Fire and forget: presence tracking must never slow down or fail a request.
  prisma.user
    .updateMany({ where: { id: userId }, data: { lastSeenAt: new Date() } })
    .catch((err) => {
      lastTouched.delete(userId);
      logger.warn("last_seen_update_failed", { message: err.message });
    });
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    return next(new ApiError(401, "Missing or malformed Authorization header."));
  }

  try {
    req.user = verifyAccessToken(token); // { sub, email, mfaEnabled, iat, exp }
  } catch (err) {
    return next(new ApiError(401, "Invalid or expired access token."));
  }

  touchLastSeen(req.user.sub);
  next();
}

module.exports = { requireAuth };
