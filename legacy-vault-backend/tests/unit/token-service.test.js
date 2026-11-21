process.env.JWT_ACCESS_SECRET = "unit-test-access-secret-0123456789abcdef";
process.env.JWT_ACCESS_EXPIRES_IN = "15m";

jest.mock("../../src/config/db", () => ({}));

const jwt = require("jsonwebtoken");
const { signAccessToken, verifyAccessToken } = require("../../src/services/token.service");

describe("access tokens", () => {
  const user = { id: "user-123", email: "person@example.test", mfaEnabled: true };

  it("signs a short-lived token with only the expected identity claims", () => {
    const token = signAccessToken(user);
    const payload = verifyAccessToken(token);

    expect(payload).toEqual(
      expect.objectContaining({ sub: user.id, email: user.email, mfaEnabled: true })
    );
    expect(payload.exp - payload.iat).toBe(15 * 60);
    expect(payload).not.toHaveProperty("password");
  });

  it("rejects tampered, wrong-secret, and expired tokens", () => {
    const token = signAccessToken(user);
    const tampered = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;
    const wrongSecret = jwt.sign({ sub: user.id }, "different-secret");
    const expired = jwt.sign({ sub: user.id }, process.env.JWT_ACCESS_SECRET, { expiresIn: -1 });

    expect(() => verifyAccessToken(tampered)).toThrow();
    expect(() => verifyAccessToken(wrongSecret)).toThrow();
    expect(() => verifyAccessToken(expired)).toThrow(/expired/i);
  });
});
