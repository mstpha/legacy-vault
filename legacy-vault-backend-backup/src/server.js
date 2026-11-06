const app = require("./app");
const logger = require("./config/logger");
const dbRouter = require("./ha/dbRouter");
const { scheduleRepeatingJob, startWorker } = require("./jobs/inactivityWorker");

const PORT = process.env.PORT || 4001;

let server;
let inactivityWorker;

// DRAINING -> A_ACTIVE: reconcile A and B right away (auto-fix, LWW), in the background.
dbRouter.onTransition((t) => {
  if (t.from !== dbRouter.STATES.DRAINING || t.to !== dbRouter.STATES.A_ACTIVE) return;
  if (process.env.SYNC_CHECK_ON_CUTOVER === "false") return;
  const { runSyncCheck } = require("./ha/syncCheck");
  runSyncCheck({ nodes: dbRouter.getNodes(), fix: true, trigger: "cutover" }).catch((err) =>
    logger.error("sync_check_after_cutover_failed", { message: err.message })
  );
});

async function main() {
  if (process.env.SERVER_ROLE && process.env.SERVER_ROLE !== "backup") {
    logger.warn(`SERVER_ROLE=${process.env.SERVER_ROLE} on the backup backend; reporting as "${process.env.SERVER_ROLE}" anyway`);
  }

  // First health check runs before we accept traffic, so the initial state is A_ACTIVE or B_ACTIVE
  // for real, not a guess.
  await dbRouter.start();

  server = app.listen(PORT, () => {
    logger.info(`Legacy Vault BACKUP API listening on port ${PORT} (${process.env.NODE_ENV || "development"})`);
  });

  // Shares the primary's Redis queue: BullMQ hands each sweep run to exactly one live worker, so
  // whichever backend is up runs it. Set INACTIVITY_WORKER_ENABLED=false to leave it to the primary.
  if (process.env.INACTIVITY_WORKER_ENABLED !== "false") {
    scheduleRepeatingJob()
      .then(() => {
        inactivityWorker = startWorker();
      })
      .catch((err) => {
        logger.error("Could not start inactivity sweep scheduler (is Redis running?)", { message: err.message });
      });
  }
}

async function shutdown(signal) {
  logger.info(`${signal} received, shutting down gracefully...`);
  const finish = async () => {
    if (inactivityWorker) await inactivityWorker.close();
    await dbRouter.stop();
    logger.info("Shutdown complete.");
    process.exit(0);
  };
  if (server) server.close(finish);
  else finish();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled promise rejection", { reason: reason?.message || reason });
});

main().catch((err) => {
  logger.error("Backup API failed to start", { message: err.message });
  process.exit(1);
});
