const { verifyAccessToken } = require("../services/token.service");
const { ApiError } = require("./errorHandler");

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    return next(new ApiError(401, "Missing or malformed Authorization header."));
  }

  try {
    req.user = verifyAccessToken(token); // { sub, email, mfaEnabled, iat, exp }
    next();
  } catch (err) {
    next(new ApiError(401, "Invalid or expired access token."));
  }
}

module.exports = { requireAuth };
