const app = require("./app");
const logger = require("./config/logger");
const prisma = require("./config/db");

const PORT = process.env.PORT || 4000;

const server = app.listen(PORT, () => {
  logger.info(`Legacy Vault API listening on port ${PORT} (${process.env.NODE_ENV || "development"})`);
});

async function shutdown(signal) {
  logger.info(`${signal} received, shutting down gracefully...`);
  server.close(async () => {
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
