import { decryptText, encryptText, createEncryptor } from "../../src/utils/encryption";
import { fromBase64 } from "../../src/utils/sealedBox";

describe("on-device capsule encryption", () => {
  jest.setTimeout(30000);

  it("encrypts and decrypts UTF-8 content with the passphrase", async () => {
    const plainText = "Sensitive vault content: café, مرحبا, 🔐";
    const ciphertext = await encryptText(plainText, "correct horse battery staple");

    expect(ciphertext).not.toContain(plainText);
    expect(decryptText(ciphertext, "correct horse battery staple")).toBe(plainText);
  });

  it("uses a fresh IV for each encrypted blob while reusing the derived key", async () => {
    const passphrase = "long enough test passphrase";
    const encryptor = await createEncryptor(passphrase);
    const first = await encryptor.encryptText("same content");
    const second = await encryptor.encryptText("same content");
    const firstBytes = fromBase64(first);
    const secondBytes = fromBase64(second);

    expect(first).not.toBe(second);
    expect(Array.from(firstBytes.slice(0, 16))).toEqual(Array.from(secondBytes.slice(0, 16)));
    expect(Array.from(firstBytes.slice(16, 32))).not.toEqual(Array.from(secondBytes.slice(16, 32)));
    expect(decryptText(first, passphrase)).toBe("same content");
    expect(decryptText(second, passphrase)).toBe("same content");
  });

  it("reports monotonically increasing progress and completes at one", async () => {
    const encryptor = await createEncryptor("progress test passphrase");
    const progress = [];
    await encryptor.encryptText("x".repeat(300000), (value) => progress.push(value));

    expect(progress.length).toBeGreaterThan(1);
    expect(progress[progress.length - 1]).toBe(1);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
  });
});
