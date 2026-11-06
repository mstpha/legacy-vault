const crypto = require("crypto");
const { getDb } = require("../config/db");
const logger = require("../config/logger");
const { verifyAccessToken } = require("../services/token.service");

// Idempotency-Key handling for POST/PUT/PATCH/DELETE (HA failover, see docs/HA_SETUP.md).
//
// The app sends the SAME key on every retry of one logical write, including a retry on the other
// server after a failover. The first request to arrive claims the key; once it finishes, its
// response is stored and replayed to every later request carrying that key. Keys live in
// ha.idempotency_keys, which is part of the A <-> B sync set, so a retry that lands on the other
// database after a switch still finds the key (within replication lag, see the doc's limits).
//
//   no key / excluded path        -> pass through
//   key claimed by us             -> run the handler, store its response; drop the key on 5xx/401/403/408/429
//   key completed, same request   -> replay the stored response, header Idempotent-Replayed: true
//   key completed, other request  -> 422
//   key still in progress         -> 503 + Retry-After: 1 (clients retry the SAME server)
//   ha schema not installed       -> pass through, warn once (keeps the API working before setup)

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
// Not stored: the same request can succeed on retry (after a token refresh, a rate-limit window...).
const NOT_STORED = new Set([401, 403, 408, 429]);
const TTL_HOURS = Number(process.env.IDEMPOTENCY_TTL_HOURS || 24);
const LOCK_MS = Number(process.env.IDEMPOTENCY_LOCK_MS || 60000);
const MAX_STORED_BODY_BYTES = Number(process.env.IDEMPOTENCY_MAX_BODY_BYTES || 256 * 1024);
// Auth responses carry fresh access/refresh tokens: never persist those in a replay table.
const EXCLUDED_PREFIXES = (process.env.IDEMPOTENCY_EXCLUDE_PREFIXES || "/api/auth/")
  .split(",")
  .map((p) => p.trim())
  .filter(Boolean);

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
let missingTableWarned = false;

function scopeOf(req) {
  const [scheme, token] = (req.headers.authorization || "").split(" ");
  if (scheme === "Bearer" && token) {
    try {
      return verifyAccessToken(token).sub;
    } catch (err) {
      // Invalid token: the route's requireAuth answers 401; no need to scope anything.
    }
  }
  return "anon";
}

function isMissingTable(err) {
  return /ha\.idempotency_keys|relation .* does not exist|42P01/.test(`${err.message} ${err.meta?.code || ""}`);
}

function idempotency(req, res, next) {
  const key = req.get("Idempotency-Key");
  if (!key || !WRITE_METHODS.has(req.method)) return next();
  if (EXCLUDED_PREFIXES.some((p) => req.originalUrl.startsWith(p))) return next();
  if (key.length > 200) {
    return res.status(400).json({ error: { message: "Idempotency-Key must be at most 200 characters." } });
  }

  handle(req, res, next, key).catch(next);
}

async function handle(req, res, next, key) {
  const db = getDb(); // pinned to this request's project (A or B) by dbRouter.pinRequest
  const scope = scopeOf(req);
  const id = sha256(`${scope}:${key}`);
  const fingerprint = sha256(`${req.method} ${req.originalUrl} ${JSON.stringify(req.body ?? null)}`);
  const expiresAt = new Date(Date.now() + TTL_HOURS * 3600 * 1000);
  const lockedUntil = new Date(Date.now() + LOCK_MS);

  let claimed;
  try {
    claimed = await db.$executeRaw`
      INSERT INTO ha.idempotency_keys (id, scope, idem_key, method, path, fingerprint, status, locked_until, expires_at)
      VALUES (${id}, ${scope}, ${key}, ${req.method}, ${req.originalUrl}, ${fingerprint}, 'in_progress', ${lockedUntil}, ${expiresAt})
      ON CONFLICT (id) DO NOTHING`;
  } catch (err) {
    if (isMissingTable(err)) {
      if (!missingTableWarned) logger.warn("idempotency_disabled", { reason: "ha.idempotency_keys missing, run ha/sql/001_ha_schema.sql" });
      missingTableWarned = true;
      return next();
    }
    throw err;
  }

  if (claimed === 0) {
    const [row] = await db.$queryRaw`
      SELECT fingerprint, status, response_status, response_body, locked_until
      FROM ha.idempotency_keys WHERE id = ${id}`;
    if (!row) return next(); // expired between the two statements: just run it

    if (row.fingerprint !== fingerprint) {
      return res.status(422).json({ error: { message: "This Idempotency-Key was already used for a different request." } });
    }
    if (row.status === "completed") {
      res.set("Idempotent-Replayed", "true");
      res.status(row.response_status);
      return row.response_body == null ? res.end() : res.json(row.response_body);
    }
    // In progress. If its owner died (lock expired), take it over; otherwise ask to retry shortly.
    const takenOver = await db.$executeRaw`
      UPDATE ha.idempotency_keys SET locked_until = ${lockedUntil}
      WHERE id = ${id} AND status = 'in_progress' AND locked_until < now()`;
    if (takenOver === 0) {
      res.set("Retry-After", "1");
      return res.status(503).json({ error: { message: "The same request is still being processed. Please retry.", code: "IDEMPOTENCY_IN_PROGRESS" } });
    }
  }

  // We own the key: capture the response and store it once it is sent.
  let body;
  const originalJson = res.json.bind(res);
  res.json = (payload) => {
    body = payload;
    return originalJson(payload);
  };

  res.on("finish", () => {
    const status = res.statusCode;
    const write =
      status >= 500 || NOT_STORED.has(status)
        ? db.$executeRaw`DELETE FROM ha.idempotency_keys WHERE id = ${id}`
        : (() => {
            let stored = body === undefined ? null : JSON.stringify(body);
            if (stored && Buffer.byteLength(stored) > MAX_STORED_BODY_BYTES) stored = JSON.stringify({ idempotentReplay: true, bodyTooLarge: true });
            return db.$executeRaw`
              UPDATE ha.idempotency_keys
              SET status = 'completed', response_status = ${status}, response_body = ${stored}::jsonb
              WHERE id = ${id}`;
          })();
    write.catch((err) => logger.error("idempotency_store_failed", { message: err.message }));
  });

  next();
}

module.exports = { idempotency };
