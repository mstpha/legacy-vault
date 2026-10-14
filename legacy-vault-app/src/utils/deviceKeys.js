import * as SecureStore from "expo-secure-store";
import { generateKeyPair, toBase64, fromBase64, seal, open, utf8Encode, utf8Decode, fingerprint } from "./sealedBox";
import { authenticate, getAuthCapability, isLockEnabled } from "./biometricLock";

// This phone's key pair for a given user. The PRIVATE key stays in the phone's secure storage
// and is never sent anywhere; only the public key is registered with the server.
//
// Protection modes (stored next to the key so reads use the matching method):
//   "hw"   private key bound to the phone's secure hardware: every read triggers the OS biometric prompt
//   "app"  stored in secure storage, and this app asks for biometrics/PIN before every read
//          (used where the OS can't gate the item itself, e.g. Expo Go on iOS)
//   "none" stored in secure storage with no prompt (the phone has no screen lock at all)

const secretName = (u) => `devkey_secret_${u}`;
const publicName = (u) => `devkey_public_${u}`;
const modeName = (u) => `devkey_mode_${u}`;

const fail = (code, message) => Object.assign(new Error(message), { code });

export async function getDeviceKeyInfo(userId) {
  try {
    const [publicKey, mode] = await Promise.all([
      SecureStore.getItemAsync(publicName(userId)),
      SecureStore.getItemAsync(modeName(userId)),
    ]);
    if (!publicKey) return { exists: false };
    return { exists: true, publicKey, mode: mode || "none", fingerprint: fingerprint(publicKey) };
  } catch (err) {
    return { exists: false };
  }
}

// Creates a brand-new key pair on this phone (replacing any old one). Returns the PUBLIC key to register.
export async function createDeviceKey(userId) {
  const capability = await getAuthCapability();
  if (capability.kind !== "none") {
    const confirmed = await authenticate("Create your device key");
    if (!confirmed) throw fail("AUTH_CANCELLED", "Authentication was cancelled.");
  }

  const pair = generateKeyPair();
  const secret = toBase64(pair.secretKey);
  let mode = "none";

  if (capability.kind !== "none") {
    try {
      await SecureStore.setItemAsync(secretName(userId), secret, {
        requireAuthentication: true,
        authenticationPrompt: "Protect your device key",
      });
      mode = "hw";
    } catch (err) {
      // This environment can't gate the item itself: store it normally and gate reads in the app.
      await SecureStore.setItemAsync(secretName(userId), secret);
      mode = "app";
    }
  } else {
    await SecureStore.setItemAsync(secretName(userId), secret);
  }

  const publicKey = toBase64(pair.publicKey);
  await SecureStore.setItemAsync(publicName(userId), publicKey);
  await SecureStore.setItemAsync(modeName(userId), mode);
  return { publicKey, mode, fingerprint: fingerprint(publicKey) };
}

export async function deleteDeviceKey(userId) {
  await Promise.all([
    SecureStore.deleteItemAsync(secretName(userId)),
    SecureStore.deleteItemAsync(publicName(userId)),
    SecureStore.deleteItemAsync(modeName(userId)),
  ]);
}

// Reads the private key. This is where the biometric prompt appears.
async function readSecretKey(userId, reason) {
  const mode = await SecureStore.getItemAsync(modeName(userId));
  if (!mode) throw fail("KEY_MISSING", "This phone has no device key for your account.");

  let encoded;
  try {
    if (mode === "hw") {
      encoded = await SecureStore.getItemAsync(secretName(userId), { requireAuthentication: true, authenticationPrompt: reason });
    } else {
      if (mode === "app" && !(await authenticate(reason))) throw fail("AUTH_CANCELLED", "Authentication was cancelled.");
      encoded = await SecureStore.getItemAsync(secretName(userId));
    }
  } catch (err) {
    if (err.code === "AUTH_CANCELLED") throw err;
    // Typically the OS invalidated the key because fingerprints/face data were changed on the phone.
    throw fail("KEY_UNREADABLE", "The device key can't be read. It may have been invalidated when biometrics changed.");
  }
  if (!encoded) throw fail("KEY_UNREADABLE", "The device key can't be read.");
  return fromBase64(encoded);
}

// Owner side: seal the capsule passphrase so only that person's device key can open it.
export function wrapPassphraseFor(recipientPublicKey, passphrase) {
  return seal(utf8Encode(passphrase), recipientPublicKey);
}

// Beneficiary side: unseal with this phone's private key (biometric prompt) and return the passphrase.
export async function openWithDeviceKey(userId, wrappedKey, reason = "Unlock with your device key") {
  const secretKey = await readSecretKey(userId, reason);
  const bytes = open(wrappedKey, secretKey);
  if (!bytes) throw fail("WRONG_KEY", "This shared key was not made for this phone's current device key.");
  return utf8Decode(bytes);
}

// Small summary for the Home screen card.
export async function getSecuritySummary(userId) {
  const [lockEnabled, info, capability] = await Promise.all([isLockEnabled(userId), getDeviceKeyInfo(userId), getAuthCapability()]);
  return { lockEnabled, keyActive: info.exists, capability: capability.kind };
}
