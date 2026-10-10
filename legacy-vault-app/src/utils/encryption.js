import CryptoJS from "crypto-js";
import * as Crypto from "expo-crypto";

// Everything here runs entirely on-device. The server only ever receives the
// base64 blob produced by encryptText/encryptBase64 below.
//
// Blob layout (unchanged, so old capsules still decrypt):
//   [ 16 bytes salt | 16 bytes IV | AES-256-CBC ciphertext ]

const KEY_SIZE_WORDS = 256 / 32;
const PBKDF2_ITERATIONS = 100000;
const SALT_BYTES = 16;
const IV_BYTES = 16;
const CHUNK_WORDS = 64 * 1024; // 256 KB per chunk (multiple of the 16-byte AES block)

const yieldToUI = () => new Promise((resolve) => setTimeout(resolve, 0));

function deriveKey(passphrase, saltWordArray) {
  return CryptoJS.PBKDF2(passphrase, saltWordArray, {
    keySize: KEY_SIZE_WORDS,
    iterations: PBKDF2_ITERATIONS,
  });
}

// Convert secure Uint8Array bytes from expo-crypto into a CryptoJS WordArray.
function uint8ArrayToWordArray(bytes) {
  const words = [];
  for (let i = 0; i < bytes.length; i++) {
    words[i >>> 2] |= bytes[i] << (24 - (i % 4) * 8);
  }
  return CryptoJS.lib.WordArray.create(words, bytes.length);
}

// Generate cryptographically secure random bytes using Expo's native crypto.
async function secureRandomWordArray(byteCount) {
  const bytes = await Crypto.getRandomBytesAsync(byteCount);
  return uint8ArrayToWordArray(bytes);
}

// Encrypt with an already-derived key. Works in chunks and yields between them
// so the UI can keep updating instead of freezing for the whole file.
async function encryptWithKey(plainWordArray, key, salt, onProgress) {
  const iv = await secureRandomWordArray(IV_BYTES);

  const encryptor = CryptoJS.algo.AES.createEncryptor(key, {
    iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });

  const out = salt.clone().concat(iv);
  const total = plainWordArray.sigBytes;

  for (let i = 0; i * 4 < total; i += CHUNK_WORDS) {
    const words = plainWordArray.words.slice(i, i + CHUNK_WORDS);
    const sigBytes = Math.min(words.length * 4, total - i * 4);
    out.concat(encryptor.process(CryptoJS.lib.WordArray.create(words, sigBytes)));
    if (onProgress) onProgress(Math.min(1, ((i + CHUNK_WORDS) * 4) / total));
    await yieldToUI();
  }

  out.concat(encryptor.finalize());
  return CryptoJS.enc.Base64.stringify(out);
}

// Derive the key ONCE (the slow part), then encrypt as many blobs as you like.
// Each blob still gets its own random IV, and the shared salt is stored inside
// every blob, so decryption works exactly as before.
export async function createEncryptor(passphrase) {
  const salt = await secureRandomWordArray(SALT_BYTES);
  await yieldToUI();
  const key = deriveKey(passphrase, salt);

  return {
    encryptText: (plainText, onProgress) =>
      encryptWithKey(CryptoJS.enc.Utf8.parse(plainText), key, salt, onProgress),
    encryptBase64: (plainBase64, onProgress) =>
      encryptWithKey(CryptoJS.enc.Base64.parse(plainBase64), key, salt, onProgress),
  };
}

function decryptToWordArray(blobBase64, passphrase) {
  const combined = CryptoJS.enc.Base64.parse(blobBase64);

  const salt = CryptoJS.lib.WordArray.create(
    combined.words.slice(0, SALT_BYTES / 4),
    SALT_BYTES
  );

  const iv = CryptoJS.lib.WordArray.create(
    combined.words.slice(SALT_BYTES / 4, (SALT_BYTES + IV_BYTES) / 4),
    IV_BYTES
  );

  const ciphertextWords = combined.words.slice((SALT_BYTES + IV_BYTES) / 4);

  const ciphertext = CryptoJS.lib.WordArray.create(
    ciphertextWords,
    combined.sigBytes - SALT_BYTES - IV_BYTES
  );

  const key = deriveKey(passphrase, salt);

  return CryptoJS.AES.decrypt({ ciphertext }, key, {
    iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });
}

// Kept for any other screen that still calls them (derives a key per call).
export async function encryptText(plainText, passphrase) {
  const enc = await createEncryptor(passphrase);
  return enc.encryptText(plainText);
}

export async function encryptBase64(plainBase64, passphrase) {
  const enc = await createEncryptor(passphrase);
  return enc.encryptBase64(plainBase64);
}

export function decryptText(blobBase64, passphrase) {
  const wordArray = decryptToWordArray(blobBase64, passphrase);
  const text = wordArray.toString(CryptoJS.enc.Utf8);

  if (!text) {
    throw new Error("Decryption failed — wrong passphrase or corrupted data.");
  }

  return text;
}

export function decryptToBase64(blobBase64, passphrase) {
  const wordArray = decryptToWordArray(blobBase64, passphrase);
  return CryptoJS.enc.Base64.stringify(wordArray);
}