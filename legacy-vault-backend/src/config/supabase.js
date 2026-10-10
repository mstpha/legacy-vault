const { createClient } = require("@supabase/supabase-js");
const logger = require("./logger");

let client = null;

function getSupabase() {
  if (client) return client;

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    logger.warn("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — file uploads will fail until configured.");
  }

  // Service-role key bypasses RLS — correct here because this client is only ever
  // used server-side, after our own auth/ownership checks already ran. Never ship
  // this key to the RN app; it only ever talks to our API over HTTPS.
  client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  return client;
}

module.exports = { getSupabase };
