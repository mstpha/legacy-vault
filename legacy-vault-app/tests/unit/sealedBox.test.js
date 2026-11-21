import {
  fromBase64,
  generateKeyPair,
  open,
  seal,
  toBase64,
  utf8Decode,
  utf8Encode,
} from "../../src/utils/sealedBox";

describe("device-key sealed boxes", () => {
  it("round-trips Unicode passphrases without exposing them in the payload", () => {
    const pair = generateKeyPair();
    const passphrase = "Clé secrète — مرحبا 🔐";
    const sealed = seal(utf8Encode(passphrase), toBase64(pair.publicKey));

    expect(sealed).not.toContain(passphrase);
    expect(utf8Decode(open(sealed, pair.secretKey))).toBe(passphrase);
  });

  it("rejects tampered payloads and malformed public keys", () => {
    const pair = generateKeyPair();
    const sealed = seal(utf8Encode("capsule key"), toBase64(pair.publicKey));
    const bytes = fromBase64(sealed);
    bytes[bytes.length - 1] ^= 1;

    expect(open(toBase64(bytes), pair.secretKey)).toBeNull();
    expect(() => seal(utf8Encode("value"), toBase64(new Uint8Array(31)))).toThrow(/public key/i);
    expect(() => fromBase64("not base64!")).toThrow(/base64/i);
  });

  it("round-trips base64 bytes including incomplete final groups", () => {
    for (const bytes of [[], [0], [1, 2], [1, 2, 3], [0, 127, 255]]) {
      expect(Array.from(fromBase64(toBase64(Uint8Array.from(bytes))))).toEqual(bytes);
    }
  });
});
