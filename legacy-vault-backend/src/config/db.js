const { PrismaClient } = require("@prisma/client");
const logger = require("./logger");

// A single shared Prisma instance (avoids exhausting Supabase's connection
// pool with a new client per request/import — important with pgbouncer).
const prisma = new PrismaClient({
  log: [
    { emit: "event", level: "warn" },
    { emit: "event", level: "error" },
  ],
});

prisma.$on("warn", (e) => logger.warn("Prisma warning", { message: e.message }));
prisma.$on("error", (e) => logger.error("Prisma error", { message: e.message }));

module.exports = prisma;
