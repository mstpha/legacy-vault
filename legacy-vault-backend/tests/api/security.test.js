process.env.NODE_ENV = "test";
process.env.SENTRY_DSN = "";
process.env.JWT_ACCESS_SECRET = "api-test-access-secret-0123456789abcdef";
process.env.AUTH_RATE_MAX = "100";
process.env.TRUST_PROXY = "false";

jest.mock("../../src/config/db", () => ({
  $queryRaw: jest.fn().mockResolvedValue([{ result: 1 }]),
  user: {
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  },
}));
jest.mock("../../src/services/token.service", () => ({
  verifyAccessToken: jest.fn((token) => {
    if (token !== "test-access-token") throw new Error("invalid token");
    return { sub: "test-user", email: "person@example.test", mfaEnabled: false };
  }),
  signAccessToken: jest.fn(),
  issueRefreshToken: jest.fn(),
  rotateRefreshToken: jest.fn(),
  revokeRefreshToken: jest.fn(),
}));
jest.mock("../../src/config/logger", () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
}));

const express = require("express");
const request = require("supertest");
const app = require("../../src/app");
const prisma = require("../../src/config/db");
const { errorHandler } = require("../../src/middleware/errorHandler");

describe("API security and input handling", () => {
  it("accepts TRUST_PROXY=false as a boolean instead of parsing it as an IP range", () => {
    expect(app.get("trust proxy")).toBe(false);
  });

  it("sets standard security headers on API responses", async () => {
    const response = await request(app).get("/health/live");

    expect(response.status).toBe(200);
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBeDefined();
    expect(response.headers["content-security-policy"]).toBeDefined();
  });

  it("answers liveness without querying the database", async () => {
    prisma.$queryRaw.mockClear();
    await request(app).get("/health/live").expect(200);

    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it.each([
    ["no authorization header", undefined],
    ["non-bearer scheme", "Basic dXNlcjpwYXNz"],
    ["invalid bearer token", "Bearer expired-or-forged"],
  ])("rejects capsule access with %s", async (_label, authorization) => {
    const call = request(app).get("/api/capsules");
    if (authorization) call.set("Authorization", authorization);
    const response = await call;

    expect(response.status).toBe(401);
    expect(response.body.error.message).toMatch(/authorization|token/i);
  });

  it("rejects malformed auth and capsule input before controller/database access", async () => {
    const login = await request(app).post("/api/auth/login").send({ email: "invalid" });
    expect(login.status).toBe(400);

    const capsule = await request(app)
      .post("/api/capsules")
      .set("Authorization", "Bearer test-access-token")
      .send({ title: "", type: "UNSUPPORTED" });
    expect(capsule.status).toBe(400);
    expect(capsule.body.error.message).toBe("Validation failed");
  });

  it("enforces the global JSON body limit", async () => {
    const response = await request(app)
      .post("/api/auth/login")
      .set("Content-Type", "application/json")
      .send({ email: "person@example.test", password: "x".repeat(1024 * 101) });

    expect(response.status).toBe(413);
  });

  it("returns generic errors without exposing backend exception details", async () => {
    const errorApp = express();
    errorApp.get("/failure", (_req, _res, next) => next(new Error("private backend topology")));
    errorApp.use(errorHandler);
    const response = await request(errorApp).get("/failure");

    expect(response.status).toBe(500);
    expect(response.body.error.message).toBe("Internal server error");
    expect(JSON.stringify(response.body)).not.toMatch(/private backend topology/i);
  });
});
