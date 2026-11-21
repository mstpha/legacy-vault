import { createEncryptor, decryptText } from "../../src/utils/encryption";

const elapsedMs = (start) => Number(process.hrtime.bigint() - start) / 1e6;

describe("mobile cryptography performance", () => {
  jest.setTimeout(60000);

  it("encrypts and decrypts a 512 KiB payload within the configured budget", async () => {
    const maxMs = Number(process.env.MOBILE_CRYPTO_MAX_MS || 15000);
    const payload = "a".repeat(512 * 1024);
    const passphrase = "performance benchmark passphrase";
    const encryptor = await createEncryptor(passphrase);
    const started = process.hrtime.bigint();
    const ciphertext = await encryptor.encryptText(payload);
    const encryptionMs = elapsedMs(started);
    const decryptStarted = process.hrtime.bigint();
    const decrypted = decryptText(ciphertext, passphrase);
    const decryptionMs = elapsedMs(decryptStarted);

    expect(decrypted).toBe(payload);
    expect(encryptionMs).toBeLessThan(maxMs);
    expect(decryptionMs).toBeLessThan(maxMs);
    console.log(JSON.stringify({ payloadBytes: payload.length, encryptionMs, decryptionMs, maxMs }));
  });
});
