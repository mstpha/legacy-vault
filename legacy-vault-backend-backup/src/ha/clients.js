const { PrismaClient } = require("@prisma/client");
const { createClient } = require("@supabase/supabase-js");
const logger = require("../config/logger");

// One "node" per Supabase project: a Prisma client for Postgres plus a service-role Storage client.
// A uses the same env names as the primary backend, so its .env block can be copied as is.
const NODE_ENV_VARS = {
  A: {
    databaseUrl: "DATABASE_URL",
    supabaseUrl: "SUPABASE_URL",
    serviceRoleKey: "SUPABASE_SERVICE_ROLE_KEY",
  },
  B: {
    databaseUrl: "B_DATABASE_URL",
    supabaseUrl: "B_SUPABASE_URL",
    serviceRoleKey: "B_SUPABASE_SERVICE_ROLE_KEY",
  },
};

function createNode(name) {
  const vars = NODE_ENV_VARS[name];
  const databaseUrl = process.env[vars.databaseUrl];
  const supabaseUrl = process.env[vars.supabaseUrl];
  const serviceRoleKey = process.env[vars.serviceRoleKey];

  if (!databaseUrl) {
    logger.warn(`ha_node_unconfigured`, { node: name, missing: vars.databaseUrl });
    return { name, configured: false, db: null, supabase: null };
  }

  const db = new PrismaClient({
    datasourceUrl: databaseUrl,
    log: [
      { emit: "event", level: "warn" },
      { emit: "event", level: "error" },
    ],
  });
  db.$on("warn", (e) => logger.warn("Prisma warning", { node: name, message: e.message }));
  // Unreachable-DB errors are reported once per outage by the router (ha_db_check_failed), not per probe.
  db.$on("error", (e) => {
    if (!/Can't reach database|timed out|ECONNREFUSED/i.test(e.message)) logger.error("Prisma error", { node: name, message: e.message });
  });

  // Service-role key bypasses RLS: only ever used server-side, after our own auth/ownership checks.
  const supabase =
    supabaseUrl && serviceRoleKey ? createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } }) : null;
  if (!supabase) logger.warn("ha_storage_unconfigured", { node: name, missing: `${vars.supabaseUrl} / ${vars.serviceRoleKey}` });

  return { name, configured: true, db, supabase };
}

function createNodes() {
  return { A: createNode("A"), B: createNode("B") };
}

async function disconnectNodes(nodes) {
  await Promise.all(Object.values(nodes).map((n) => (n.db ? n.db.$disconnect().catch(() => {}) : null)));
}

// Errors that mean "this project is unreachable right now" (retry later / fail over), as opposed to
// errors about the data itself (constraint violations...).
const CONNECTION_ERROR_CODES = new Set(["P1001", "P1002", "P1008", "P1011", "P1017", "P2024"]);
function isConnectionError(err) {
  if (!err) return false;
  if (err.name === "PrismaClientInitializationError" || err.name === "PrismaClientRustPanicError") return true;
  if (CONNECTION_ERROR_CODES.has(err.code)) return true;
  return /timed out|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|Can't reach database|Connection terminated|fetch failed/i.test(
    err.message || ""
  );
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

module.exports = { createNodes, disconnectNodes, isConnectionError, withTimeout };
