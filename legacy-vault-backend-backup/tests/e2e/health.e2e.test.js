const express = require("express");
const request = require("supertest");
const h = require("../helpers/e2e");
const redis = require("../../src/config/redis"); // the mock from tests/setup/mocks.js
const { runInactivitySweep } = require("../../src/services/monitoring.service");

afterAll(async () => {
  await h.prisma.$disconnect();
});

describe("GET /health/live (liveness)", () => {
  it("answers without touching any dependency", async () => {
    const res = await h.api("get", "/health/live");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({ status: "ok", uptime: expect.any(Number), version: expect.any(String), timestamp: expect.any(String) })
    );
  });
});

describe("GET /health/ready (readiness)", () => {
  it("is ok when the database and Redis answer; the sweep is 'pending' right after boot", async () => {
    const res = await h.api("get", "/health/ready");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.checks.database.status).toBe("up");
    expect(res.body.checks.redis.status).toBe("up");
    expect(res.body.checks.inactivitySweep.status).toBe("pending");
  });

  it("reports the sweep heartbeat once the engine has run", async () => {
    await runInactivitySweep();
    const res = await h.api("get", "/health/ready");
    expect(res.body.checks.inactivitySweep.status).toBe("ok");
    expect(res.body.checks.inactivitySweep.lastRunAt).toEqual(expect.any(String));
    expect(res.body.checks.inactivitySweep.lastDurationMs).toEqual(expect.any(Number));
  });

  it("is 'degraded' (still HTTP 200) when Redis is down: the API serves but inactivity detection cannot run", async () => {
    redis.ping.mockRejectedValueOnce(new Error("redis down"));
    const res = await h.api("get", "/health/ready");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("degraded");
    expect(res.body.checks.redis.status).toBe("down");
    expect(JSON.stringify(res.body)).not.toMatch(/redis down/); // error details stay in the logs
  });

  it("is 503 when the database is unreachable", async () => {
    let brokenApp;
    jest.isolateModules(() => {
      jest.doMock("../../src/config/db", () => ({ getDb: () => ({ $queryRaw: jest.fn().mockRejectedValue(new Error("db down")) }) }));
      const router = require("../../src/routes/health.routes");
      brokenApp = express();
      brokenApp.use("/health", router);
    });
    const res = await request(brokenApp).get("/health/ready");
    expect(res.status).toBe(503);
    expect(res.body.status).toBe("unavailable");
    expect(res.body.checks.database.status).toBe("down");
  });
});
