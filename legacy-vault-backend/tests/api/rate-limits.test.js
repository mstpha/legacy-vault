process.env.AUTH_RATE_MAX = "2";
process.env.AUTH_RATE_WINDOW_MINUTES = "1";

jest.mock("../../src/config/logger", () => ({
  error: jest.fn(),
  warn: jest.fn(),
}));

const express = require("express");
const request = require("supertest");
const { authLimiter } = require("../../src/middleware/rateLimiter");
const { validationLimiter } = require("../../src/middleware/sensitiveLimiters");
const { errorHandler } = require("../../src/middleware/errorHandler");

describe("rate limits", () => {
  it("caps authentication attempts and includes standard rate-limit headers", async () => {
    const app = express();
    app.post("/login", authLimiter, (_req, res) => res.sendStatus(200));
    app.use(errorHandler);

    const first = await request(app).post("/login");
    const second = await request(app).post("/login");
    const third = await request(app).post("/login");

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(429);
    expect(third.headers["ratelimit-limit"]).toBe("2");
    expect(third.body.error.message).toMatch(/too many attempts/i);
  });

  it("limits sensitive actions per authenticated user, not shared IP", async () => {
    const app = express();
    app.post(
      "/vote",
      (req, _res, next) => {
        req.user = { sub: req.get("x-test-user") };
        next();
      },
      validationLimiter,
      (_req, res) => res.sendStatus(200)
    );
    app.use(errorHandler);
    const userA = `rate-limit-a-${Date.now()}`;
    const userB = `rate-limit-b-${Date.now()}`;

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await request(app).post("/vote").set("x-test-user", userA).expect(200);
    }

    await request(app).post("/vote").set("x-test-user", userB).expect(200);
    const blocked = await request(app).post("/vote").set("x-test-user", userA);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.message).toMatch(/validation attempts/i);
  });
});
