const {
  hashPassword,
  verifyPassword,
  hashToken,
  generateOpaqueToken,
} = require("../../src/utils/password");
const {
  registerSchema,
  mfaTokenSchema,
  createCapsuleSchema,
  thresholdsSchema,
  uploadFileSchema,
} = require("../../src/utils/validators");

describe("credential primitives", () => {
  it("hashes passwords with bcrypt and verifies only the matching password", async () => {
    const plain = "A strong test password! 123";
    const hash = await hashPassword(plain);

    expect(hash).not.toBe(plain);
    expect(hash).toMatch(/^\$2[aby]\$/);
    await expect(verifyPassword(plain, hash)).resolves.toBe(true);
    await expect(verifyPassword("incorrect password", hash)).resolves.toBe(false);
  });

  it("stores refresh tokens as one-way hashes and generates high-entropy opaque tokens", () => {
    const first = generateOpaqueToken();
    const second = generateOpaqueToken();

    expect(first).toMatch(/^[a-f0-9]{96}$/);
    expect(second).not.toBe(first);
    expect(hashToken(first)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashToken(first)).not.toBe(first);
    expect(hashToken(first)).toBe(hashToken(first));
  });
});

describe("input validation boundaries", () => {
  it("accepts valid registration and rejects weak passwords and malformed email", () => {
    expect(
      registerSchema.safeParse({
        email: "person@example.test",
        password: "valid-password-123",
        fullName: "Test Person",
      }).success
    ).toBe(true);
    expect(
      registerSchema.safeParse({
        email: "not-an-email",
        password: "short",
        fullName: "T",
      }).success
    ).toBe(false);
  });

  it("requires six-character MFA tokens", () => {
    expect(mfaTokenSchema.safeParse({ token: "123456" }).success).toBe(true);
    expect(mfaTokenSchema.safeParse({ token: "12345" }).success).toBe(false);
    expect(mfaTokenSchema.safeParse({ token: "1234567" }).success).toBe(false);
  });

  it("enforces capsule type, thresholds, and encrypted file fields", () => {
    expect(createCapsuleSchema.safeParse({ title: "Vault", type: "MESSAGE" }).success).toBe(true);
    expect(createCapsuleSchema.safeParse({ title: "Vault", type: "UNKNOWN" }).success).toBe(false);
    expect(
      thresholdsSchema.safeParse({
        inactivityThresholdDays: 1,
        graceWindowDays: 365,
        validationThreshold: 20,
      }).success
    ).toBe(true);
    expect(
      thresholdsSchema.safeParse({
        inactivityThresholdDays: 0,
        graceWindowDays: 366,
        validationThreshold: 21,
      }).success
    ).toBe(false);
    expect(
      uploadFileSchema.safeParse({
        fileName: "secret.bin",
        mimeType: "application/octet-stream",
        encryptedContentBase64: "AQID",
      }).success
    ).toBe(true);
    expect(
      uploadFileSchema.safeParse({
        fileName: "secret.bin",
        mimeType: "application/octet-stream",
        encryptedContentBase64: "",
      }).success
    ).toBe(false);
  });
});
