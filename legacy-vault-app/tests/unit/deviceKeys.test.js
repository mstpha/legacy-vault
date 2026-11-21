jest.mock("expo-secure-store", () => {
  const values = new Map();
  return {
    __values: values,
    getItemAsync: jest.fn(async (key) => values.get(key) ?? null),
    setItemAsync: jest.fn(async (key, value) => values.set(key, value)),
    deleteItemAsync: jest.fn(async (key) => values.delete(key)),
  };
});

jest.mock("../../src/utils/biometricLock", () => ({
  authenticate: jest.fn(),
  getAuthCapability: jest.fn(),
  isLockEnabled: jest.fn(),
}));

import * as SecureStore from "expo-secure-store";
import { authenticate, getAuthCapability } from "../../src/utils/biometricLock";
import { createDeviceKey, openWithDeviceKey, wrapPassphraseFor } from "../../src/utils/deviceKeys";

describe("mobile device keys", () => {
  beforeEach(() => {
    SecureStore.__values.clear();
    getAuthCapability.mockResolvedValue({ kind: "none" });
    authenticate.mockResolvedValue(true);
  });

  it("persists the private key only in secure storage and opens a recipient-wrapped passphrase", async () => {
    const userId = "user-1";
    const keyInfo = await createDeviceKey(userId);
    const wrapped = wrapPassphraseFor(keyInfo.publicKey, "capsule passphrase");

    await expect(openWithDeviceKey(userId, wrapped)).resolves.toBe("capsule passphrase");
    expect(SecureStore.__values.has(`devkey_secret_${userId}`)).toBe(true);
    expect(SecureStore.__values.has(`devkey_public_${userId}`)).toBe(true);
    expect(keyInfo.fingerprint).toMatch(/^[A-F0-9]{4}( [A-F0-9]{4}){4}$/);
  });

  it("requires successful device authentication before creating a protected key", async () => {
    getAuthCapability.mockResolvedValue({ kind: "biometric" });
    authenticate.mockResolvedValue(false);

    await expect(createDeviceKey("user-2")).rejects.toMatchObject({ code: "AUTH_CANCELLED" });
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  });
});
