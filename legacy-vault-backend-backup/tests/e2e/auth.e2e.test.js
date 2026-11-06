// Auth end-to-end: register -> email verification -> login -> MFA -> refresh rotation -> logout.
// (Replaces the Sprint 1 auth test, which predated email verification and no longer matched the API.)
const { authenticator } = require("otplib");
const h = require("../helpers/e2e");

const { prisma, api } = h;
const email = `${h.EMAIL_PREFIX}auth@example.test`;
const password = "SuperSecret123!";
let accessToken;
let refreshToken;
let userId;

afterAll(async () => {
  await h.cleanup();
  await prisma.$disconnect();
});

describe("Registration and email verification", () => {
  it("GET /health is alive", async () => {
    const res = await api("get", "/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("rejects a weak password and malformed input", async () => {
    expect((await api("post", "/api/auth/register", null, { email, password: "short", fullName: "T U" })).status).toBe(400);
    expect((await api("post", "/api/auth/register", null, { email: "not-an-email", password, fullName: "T U" })).status).toBe(400);
  });

  it("registers a user, stores no plaintext secret, and emails a six-digit code", async () => {
    const res = await api("post", "/api/auth/register", null, { email, password, fullName: "Test User" });
    expect(res.status).toBe(201);
    expect(res.body.email).toBe(email);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash/);

    const row = await prisma.user.findUnique({ where: { email } });
    userId = row.id;
    expect(row.emailVerified).toBe(false);
    expect(row.passwordHash).not.toBe(password);
    expect(row.emailVerificationCodeHash).not.toMatch(/^\d{6}$/); // code is stored hashed
    expect(h.lastVerificationCode(email)).toMatch(/^\d{6}$/);
    expect(await h.waitFor(() => h.prisma.auditLog.count({ where: { userId, action: "USER_REGISTERED" } }))).toBe(1);
  });

  it("rejects a duplicate registration", async () => {
    const res = await api("post", "/api/auth/register", null, { email, password, fullName: "Test User" });
    expect(res.status).toBe(409);
  });

  it("refuses login until the email is verified (and sends a fresh code)", async () => {
    const res = await api("post", "/api/auth/login", null, { email, password });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toBe("EMAIL_NOT_VERIFIED");
  });

  it("rejects a wrong code, then accepts the right one", async () => {
    const wrong = await api("post", "/api/auth/verify-email", null, { email, code: "000000" });
    expect(wrong.status).toBe(400);

    const code = h.lastVerificationCode(email);
    const ok = await api("post", "/api/auth/verify-email", null, { email, code });
    expect(ok.status).toBe(200);
    expect((await prisma.user.findUnique({ where: { email } })).emailVerified).toBe(true);
  });
});

describe("Login, sessions and refresh-token rotation", () => {
  it("rejects a wrong password with a generic error", async () => {
    const res = await api("post", "/api/auth/login", null, { email, password: "wrong-password" });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe("Invalid email or password.");
    expect((await api("post", "/api/auth/login", null, { email: "nobody@example.test", password })).body.error.message).toBe(
      "Invalid email or password."
    ); // same message: no account enumeration
  });

  it("logs in, returns tokens and never leaks secrets", async () => {
    const res = await api("post", "/api/auth/login", null, { email, password });
    expect(res.status).toBe(200);
    accessToken = res.body.accessToken;
    refreshToken = res.body.refreshToken;
    expect(accessToken).toBeDefined();
    expect(refreshToken).toBeDefined();
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(res.body.user.mfaSecret).toBeUndefined();

    const row = await prisma.user.findUnique({ where: { id: userId } });
    expect(row.lastLoginAt).toBeInstanceOf(Date);
    // Only a hash of the refresh token is stored.
    expect(await prisma.refreshToken.count({ where: { userId, tokenHash: refreshToken } })).toBe(0);
  });

  it("writes login events into the HASH-CHAINED audit log (regression: they used to be unchained)", async () => {
    const entry = await h.waitFor(() => prisma.auditLog.findFirst({ where: { userId, action: "USER_LOGGED_IN" } }));
    expect(entry.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(entry.prevHash).toBeTruthy();
  });

  it("protects /me", async () => {
    expect((await api("get", "/api/auth/me")).status).toBe(401);
    expect((await api("get", "/api/auth/me", "garbage.token.value")).status).toBe(401);
    const me = await api("get", "/api/auth/me", accessToken);
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(email);
    expect(me.body.user.passwordHash).toBeUndefined();
  });

  it("rotates the refresh token and rejects reuse of the old one", async () => {
    const first = await api("post", "/api/auth/refresh", null, { refreshToken });
    expect(first.status).toBe(200);
    expect(first.body.refreshToken).not.toBe(refreshToken);

    const reuse = await api("post", "/api/auth/refresh", null, { refreshToken });
    expect(reuse.status).toBe(401);
    refreshToken = first.body.refreshToken;
  });

  it("lets exactly ONE of two parallel refreshes with the same token win (regression: both used to succeed)", async () => {
    const [a, b] = await Promise.all([
      api("post", "/api/auth/refresh", null, { refreshToken }),
      api("post", "/api/auth/refresh", null, { refreshToken }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 401]);
    refreshToken = (a.status === 200 ? a : b).body.refreshToken;
  });

  it("logout revokes the refresh token", async () => {
    const out = await api("post", "/api/auth/logout", accessToken, { refreshToken });
    expect(out.status).toBe(204);
    expect((await api("post", "/api/auth/refresh", null, { refreshToken })).status).toBe(401);
  });
});

describe("TOTP MFA", () => {
  let secret;
  it("enrolls: setup returns a secret + QR, confirm needs a valid code", async () => {
    const login = await api("post", "/api/auth/login", null, { email, password });
    accessToken = login.body.accessToken;

    const setup = await api("post", "/api/auth/mfa/setup", accessToken);
    expect(setup.status).toBe(200);
    expect(setup.body.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);
    secret = setup.body.secret;

    expect((await api("post", "/api/auth/mfa/confirm", accessToken, { token: "000000" })).status).toBe(400);
    const confirm = await api("post", "/api/auth/mfa/confirm", accessToken, { token: authenticator.generate(secret) });
    expect(confirm.status).toBe(200);
    expect(confirm.body.mfaEnabled).toBe(true);
    accessToken = confirm.body.accessToken;
  });

  it("then login requires the code and rejects a wrong one", async () => {
    const step1 = await api("post", "/api/auth/login", null, { email, password });
    expect(step1.status).toBe(200);
    expect(step1.body).toEqual({ mfaRequired: true });
    expect(step1.body.accessToken).toBeUndefined();

    expect((await api("post", "/api/auth/login", null, { email, password, mfaToken: "000000" })).status).toBe(401);
    const ok = await api("post", "/api/auth/login", null, { email, password, mfaToken: authenticator.generate(secret) });
    expect(ok.status).toBe(200);
    expect(ok.body.accessToken).toBeDefined();
    expect(await h.waitFor(() => prisma.auditLog.count({ where: { userId, action: "MFA_LOGIN_REJECTED" } }))).toBe(1);
  });

  it("disabling MFA needs a valid code (a stolen access token alone is not enough)", async () => {
    expect((await api("post", "/api/auth/mfa/disable", accessToken, { token: "000000" })).status).toBe(400);
    const res = await api("post", "/api/auth/mfa/disable", accessToken, { token: authenticator.generate(secret) });
    expect(res.status).toBe(200);
    expect(res.body.mfaEnabled).toBe(false);
    expect((await prisma.user.findUnique({ where: { id: userId } })).mfaSecret).toBeNull();
  });
});
