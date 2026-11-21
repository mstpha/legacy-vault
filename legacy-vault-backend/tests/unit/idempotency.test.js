jest.mock("../../src/config/db", () => ({
  $executeRaw: jest.fn(),
}));
jest.mock("../../src/services/token.service", () => ({
  verifyAccessToken: jest.fn(() => ({ sub: "test-user" })),
}));
jest.mock("../../src/config/logger", () => ({
  warn: jest.fn(),
  error: jest.fn(),
}));

const express = require("express");
const request = require("supertest");
const prisma = require("../../src/config/db");
const { idempotency } = require("../../src/middleware/idempotency");

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(idempotency);
  app.post("/api/write", (_req, res) => res.status(201).json({ saved: true }));
  app.post("/api/auth/login", (_req, res) => res.status(200).json({ accessToken: "one-time" }));
  return app;
}

describe("idempotency middleware safety", () => {
  const app = createApp();

  it("passes requests without keys and auth responses through without database writes", async () => {
    await request(app).post("/api/write").send({ value: 1 }).expect(201);
    await request(app).post("/api/auth/login").set("Idempotency-Key", "login-key").send({}).expect(200);

    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it("rejects oversized keys before touching persistence", async () => {
    const response = await request(app)
      .post("/api/write")
      .set("Idempotency-Key", "x".repeat(201))
      .send({ value: 1 });

    expect(response.status).toBe(400);
    expect(response.body.error.message).toMatch(/at most 200 characters/i);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it("continues safely when the optional HA idempotency table is not installed", async () => {
    prisma.$executeRaw.mockRejectedValueOnce(
      new Error('relation "ha.idempotency_keys" does not exist')
    );

    const response = await request(app)
      .post("/api/write")
      .set("Authorization", "Bearer test-token")
      .set("Idempotency-Key", "safe-fallback")
      .send({ value: 1 });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ saved: true });
  });
});
