const IORedis = require("ioredis");
const logger = require("./logger");

// BullMQ requires maxRetriesPerRequest: null on the connection it's handed.
const connection = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});

connection.on("error", (err) => logger.error("Redis connection error", { message: err.message }));

module.exports = connection;
