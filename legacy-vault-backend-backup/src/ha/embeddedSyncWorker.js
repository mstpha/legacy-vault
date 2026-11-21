const { spawn } = require("child_process");
const path = require("path");
const logger = require("../config/logger");

function startEmbeddedSyncWorker() {
  const child = spawn(process.execPath, [path.join(__dirname, "syncWorker.js")], {
    cwd: path.resolve(__dirname, "../.."),
    env: process.env,
    stdio: ["ignore", "inherit", "inherit"],
  });

  let stopping = false;
  let exited = false;
  let stopPromise;

  child.on("error", (err) => {
    logger.error("embedded_sync_worker_spawn_failed", { message: err.message });
  });

  child.on("exit", (code, signal) => {
    exited = true;
    if (!stopping) logger.error("embedded_sync_worker_exited", { code, signal });
  });

  return function stopEmbeddedSyncWorker() {
    if (stopPromise) return stopPromise;
    if (exited || !child.pid) return Promise.resolve();

    stopping = true;
    stopPromise = new Promise((resolve) => {
      const timer = setTimeout(() => {
        logger.error("embedded_sync_worker_shutdown_timeout");
        child.kill("SIGKILL");
        resolve();
      }, 5000);
      timer.unref();

      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });

      if (!child.kill("SIGTERM")) {
        clearTimeout(timer);
        resolve();
      }
    });

    return stopPromise;
  };
}

module.exports = { startEmbeddedSyncWorker };
