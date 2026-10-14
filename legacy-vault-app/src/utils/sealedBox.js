import nacl from "tweetnacl";
import * as Crypto from "expo-crypto";

// Device-key cryptography: X25519 key pairs + "sealed boxes".
//
// A sealed box lets ANYONE with your public key encrypt a message that ONLY your private key
// can open: the sender makes a throw-away key pair, encrypts with it, and sends the throw-away
// PUBLIC key along. Layout (base64 of): [ 32 bytes ephemeral public key | 24 bytes nonce | box ]
// Pure JavaScript (tweetnacl), so it works in Expo Go; randomness comes from the phone's CSPRNG.

nacl.setPRNG((target, count) => {
  const random = Crypto.getRandomBytes(count);
  for (let i = 0; i < count; i++) target[i] = random[i];
});

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function toBase64(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63];
    out += i + 1 < bytes.length ? ALPHABET[(n >> 6) & 63] : "=";
    out += i + 2 < bytes.length ? ALPHABET[n & 63] : "=";
  }
  return out;
}

export function fromBase64(text) {
  const clean = text.replace(/=+$/, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let index = 0;
  for (const ch of clean) {
    const value = ALPHABET.indexOf(ch);
    if (value < 0) throw new Error("Invalid base64");
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[index++] = (buffer >> bits) & 255;
    }
  }
  return out;
}

// Hand-written UTF-8 so passphrases in Arabic, French accents or emoji survive exactly
// (no dependency on TextEncoder being present).
export function utf8Encode(text) {
  const out = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
  }
  return Uint8Array.from(out);
}

export function utf8Decode(bytes) {
  let text = "";
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i++];
    let cp;
    if (b < 0x80) cp = b;
    else if (b < 0xe0) cp = ((b & 31) << 6) | (bytes[i++] & 63);
    else if (b < 0xf0) cp = ((b & 15) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63);
    else cp = ((b & 7) << 18) | ((bytes[i++] & 63) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63);
    text += String.fromCodePoint(cp);
  }
  return text;
}

export const generateKeyPair = () => nacl.box.keyPair();

// Encrypts `plainBytes` so only the holder of the matching private key can open it.
export function seal(plainBytes, recipientPublicKeyBase64) {
  const recipientKey = fromBase64(recipientPublicKeyBase64);
  if (recipientKey.length !== 32) throw new Error("Invalid public key");

  const ephemeral = nacl.box.keyPair();
  const nonce = nacl.randomBytes(24);
  const boxed = nacl.box(plainBytes, nonce, recipientKey, ephemeral.secretKey);

  const out = new Uint8Array(32 + 24 + boxed.length);
  out.set(ephemeral.publicKey, 0);
  out.set(nonce, 32);
  out.set(boxed, 56);
  return toBase64(out);
}

// Returns the plaintext bytes, or null if this key can't open it (wrong key, or tampered data).
export function open(sealedBase64, secretKey) {
  const data = fromBase64(sealedBase64);
  if (data.length < 32 + 24 + 16) return null;
  return nacl.box.open(data.slice(56), data.slice(32, 56), data.slice(0, 32), secretKey);
}

// Short code two people can compare out loud to confirm a public key is the real one.
// Same algorithm as the server (SHA-512, first 10 bytes), shown as "AB12 CD34 EF56 7890 1234".
export function fingerprint(publicKeyBase64) {
  const digest = nacl.hash(fromBase64(publicKeyBase64));
  let hex = "";
  for (let i = 0; i < 10; i++) hex += digest[i].toString(16).padStart(2, "0");
  return hex.toUpperCase().replace(/(.{4})/g, "$1 ").trim();
}
