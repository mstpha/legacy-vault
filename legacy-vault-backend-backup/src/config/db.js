// Backup backend: the single data-access provider. There is no exported Prisma singleton on
// purpose; every caller asks the HA router for the client of the currently active project
// (pinned per request), so no code path can bypass failover.
const router = require("../ha/dbRouter");

function getDb() {
  return router.getDb();
}

module.exports = { getDb };
