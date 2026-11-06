const { Queue, Worker } = require("bullmq");
const connection = require("../config/redis");
const logger = require("../config/logger");
const { runInactivitySweep } = require("../services/monitoring.service");

const QUEUE_NAME = "inactivity-sweep";
const JOB_NAME = "sweep";

// Run every 15 minutes by default. For a real "90 days inactivity" threshold this
// is frequent enough — tighten it in environments that need faster reaction time,
// but don't go so tight that it starts competing with request traffic for Redis.
const INTERVAL_MS = Number(process.env.INACTIVITY_SWEEP_INTERVAL_MS || 15 * 60 * 1000);

const queue = new Queue(QUEUE_NAME, { connection });

async function scheduleRepeatingJob() {
  // removeOnComplete/Fail keep Redis from accumulating job history forever.
  await queue.add(
    JOB_NAME,
    {},
    {
      repeat: { every: INTERVAL_MS },
      removeOnComplete: 50,
      removeOnFail: 50,
    }
  );
  logger.info(`Inactivity sweep scheduled every ${INTERVAL_MS}ms.`);
}

function startWorker() {
  const worker = new Worker(
    QUEUE_NAME,
    async () => {
      const result = await runInactivitySweep();
      logger.info("inactivity_sweep_ran", result);
      return result;
    },
    { connection }
  );

  worker.on("failed", (job, err) => {
    logger.error("inactivity_sweep_failed", { jobId: job?.id, message: err.message });
  });

  return worker;
}

module.exports = { queue, scheduleRepeatingJob, startWorker };
