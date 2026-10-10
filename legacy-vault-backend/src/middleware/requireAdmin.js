const prisma = require("../config/db");
const { ApiError } = require("./errorHandler");

// Mount AFTER requireAuth. Deliberately re-reads the DB rather than trusting any
// role claim on the JWT — same reasoning as auth.service#getProfile: a role
// change (e.g. being made admin, or demoted) must take effect immediately, not
// whenever the caller's access token happens to expire and refresh.
async function requireAdmin(req, res, next) {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.sub } });
    if (!user || user.role !== "ADMIN") {
      return next(new ApiError(403, "Admin access required."));
    }
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireAdmin };
