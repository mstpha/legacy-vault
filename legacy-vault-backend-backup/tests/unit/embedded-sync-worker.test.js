const { EventEmitter } = require("events");

jest.mock("child_process", () => ({ spawn: jest.fn() }));
jest.mock("../../src/config/logger", () => ({ error: jest.fn() }));

const { spawn } = require("child_process");
const { startEmbeddedSyncWorker } = require("../../src/ha/embeddedSyncWorker");
const logger = require("../../src/config/logger");

describe("embedded sync worker process", () => {
  let child;

  beforeEach(() => {
    jest.clearAllMocks();
    child = new EventEmitter();
    child.pid = 123;
    child.kill = jest.fn(() => true);
    spawn.mockReturnValue(child);
  });

  it("starts the worker and shuts it down gracefully", async () => {
    const stop = startEmbeddedSyncWorker();
    expect(spawn).toHaveBeenCalledWith(
      process.execPath,
      [expect.stringContaining("syncWorker.js")],
      expect.objectContaining({ stdio: ["ignore", "inherit", "inherit"] })
    );

    const stopped = stop();
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    child.emit("exit", 0, "SIGTERM");
    await stopped;
    expect(logger.error).not.toHaveBeenCalled();
  });
});
