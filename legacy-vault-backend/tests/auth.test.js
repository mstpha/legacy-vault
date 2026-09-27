const request = require("supertest");
const app = require("../src/app");
const prisma = require("../src/config/db");

// Requires a real (test) Supabase/Postgres database reachable via DATABASE_URL.
// Run `npx prisma migrate deploy` against a disposable test DB before running this.

describe("Auth (Sprint 1)", () => {
  const email = `test.${Date.now()}@example.com`;
  const password = "SuperSecret123!";

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email } });
    await prisma.$disconnect();
  });

  it("GET /health returns ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("registers a new user", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email, password, fullName: "Test User" });
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe(email);
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it("rejects duplicate registration", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email, password, fullName: "Test User" });
    expect(res.status).toBe(409);
  });

  it("logs in without MFA and returns tokens", async () => {
    const res = await request(app).post("/api/auth/login").send({ email, password });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
  });

  it("rejects login with wrong password", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email, password: "wrong-password" });
    expect(res.status).toBe(401);
  });

  it("refreshes tokens and rotates the refresh token", async () => {
    const loginRes = await request(app).post("/api/auth/login").send({ email, password });
    const oldRefresh = loginRes.body.refreshToken;

    const refreshRes = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: oldRefresh });
    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.refreshToken).not.toBe(oldRefresh);

    // Reusing the old (now revoked) refresh token must fail.
    const reuseRes = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: oldRefresh });
    expect(reuseRes.status).toBe(401);
  });
});
