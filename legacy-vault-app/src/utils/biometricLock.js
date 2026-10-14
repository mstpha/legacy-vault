import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";

// Phone biometric lock (Face ID / fingerprint / face unlock), with graceful fallbacks.
//
// What this phone can do, in order of preference:
//   "biometric": a fingerprint or face is enrolled  -> the OS biometric prompt
//   "device":    no biometrics, but a PIN/pattern/password is set -> the OS prompt falls back to it
//   "none":      no screen lock at all, or no support -> the lock can't be used (UI explains why)
//
// The biometric data itself never reaches this app or the server: the OS only answers yes or no.

export const LOCK_GRACE_MS = 30 * 1000; // how long the app may stay in the background before it re-locks

const lockKey = (userId) => `lock_enabled_${userId}`;
const listeners = new Set();

export function onLockSettingChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function getAuthCapability() {
  try {
    const [hasHardware, enrolled, level, types] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
      LocalAuthentication.getEnrolledLevelAsync(),
      LocalAuthentication.supportedAuthenticationTypesAsync(),
    ]);

    let kind = "none";
    if (enrolled) kind = "biometric";
    else if (level >= LocalAuthentication.SecurityLevel.SECRET) kind = "device";

    const face = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
    const finger = types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT);
    const label = face && finger ? "Face or fingerprint" : face ? "Face recognition" : finger ? "Fingerprint" : "Biometrics";

    return { kind, hasHardware, enrolled, label };
  } catch (err) {
    return { kind: "none", hasHardware: false, enrolled: false, label: "Biometrics" };
  }
}

// Shows the OS prompt. Resolves true only if the user really authenticated.
export async function authenticate(reason = "Confirm it's you") {
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: reason,
      cancelLabel: "Cancel",
      disableDeviceFallback: false, // let the phone's PIN/pattern work when biometrics fail or aren't set up
    });
    return !!result.success;
  } catch (err) {
    return false;
  }
}

export async function isLockEnabled(userId) {
  try {
    return (await SecureStore.getItemAsync(lockKey(userId))) === "1";
  } catch (err) {
    return false;
  }
}

export async function setLockEnabled(userId, enabled) {
  if (enabled) await SecureStore.setItemAsync(lockKey(userId), "1");
  else await SecureStore.deleteItemAsync(lockKey(userId));
  listeners.forEach((listener) => listener(enabled));
}

// Step-up check before a sensitive action (revoke, validate, open a capsule, share keys...).
// - Lock not turned on          -> proceed (the user chose not to use it)
// - Lock on, phone can prompt   -> must pass the prompt
// - Lock on, phone lost its screen lock -> proceed (never lock people out of their own data)
export async function confirmSensitive(userId, reason) {
  if (!(await isLockEnabled(userId))) return true;
  const capability = await getAuthCapability();
  if (capability.kind === "none") return true;
  return authenticate(reason);
}
