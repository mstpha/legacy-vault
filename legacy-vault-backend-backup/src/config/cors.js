// CORS for the Expo web build (native iOS/Android requests are not subject to CORS).
// CORS_ORIGINS: comma-separated list, e.g. "http://localhost:8081,http://localhost:19006".
// Unset or "*" keeps the previous behaviour (any origin). Both the primary and the backup must
// list the same origins, otherwise a web client breaks exactly when it fails over.
const raw = (process.env.CORS_ORIGINS || "*").trim();
const origins = raw === "*" ? "*" : raw.split(",").map((o) => o.trim()).filter(Boolean);

module.exports = {
  origin: origins,
  // Request headers are reflected (covers Authorization and Idempotency-Key). Retry-After and
  // Idempotent-Replayed are not CORS-safelisted: a web client could not read them without this.
  exposedHeaders: ["Retry-After", "Idempotent-Replayed", "RateLimit-Limit", "RateLimit-Remaining", "RateLimit-Reset"],
  maxAge: 600,
};
