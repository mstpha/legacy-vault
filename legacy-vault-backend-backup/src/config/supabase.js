// Backup backend: Storage client of the currently active Supabase project (A or B), resolved by the
// HA router, same as getDb(). Service-role key, server-side only, never shipped to the app.
const router = require("../ha/dbRouter");

function getSupabase() {
  return router.getStorage();
}

module.exports = { getSupabase };
