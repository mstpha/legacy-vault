const app = require("./app");
const logger = require("./config/logger");
const prisma = require("./config/db");
const { scheduleRepeatingJob, startWorker } = require("./jobs/inactivityWorker");

const PORT = process.env.PORT || 4000;

const server = app.listen(PORT, () => {
  logger.info(`Legacy Vault API listening on port ${PORT} (${process.env.NODE_ENV || "development"})`);
});

let inactivityWorker;
scheduleRepeatingJob()
  .then(() => {
    inactivityWorker = startWorker();
  })
  .catch((err) => {
    // Redis being unreachable shouldn't crash the whole API — just the scheduler.
    logger.error("Could not start inactivity sweep scheduler (is Redis running?)", { message: err.message });
  });

async function shutdown(signal) {
  logger.info(`${signal} received, shutting down gracefully...`);
  server.close(async () => {
    if (inactivityWorker) await inactivityWorker.close();
    await prisma.$disconnect();
    logger.info("Shutdown complete.");
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled promise rejection", { reason: reason?.message || reason });
});
