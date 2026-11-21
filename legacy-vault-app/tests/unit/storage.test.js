jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

import * as SecureStore from "expo-secure-store";
import { deleteItem, getItem, setItem, STORAGE_KEYS } from "../../src/utils/storage";

describe("secure token storage", () => {
  it("uses stable secure-store keys and forwards values", async () => {
    SecureStore.getItemAsync.mockResolvedValue("access-value");
    await setItem(STORAGE_KEYS.REFRESH_TOKEN, "refresh-value");
    await deleteItem(STORAGE_KEYS.ACCESS_TOKEN);

    expect(await getItem(STORAGE_KEYS.ACCESS_TOKEN)).toBe("access-value");
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(STORAGE_KEYS.REFRESH_TOKEN, "refresh-value");
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(STORAGE_KEYS.ACCESS_TOKEN);
    expect(STORAGE_KEYS.ACCESS_TOKEN).not.toBe(STORAGE_KEYS.REFRESH_TOKEN);
  });

  it("reports keychain read failures and returns no token", async () => {
    const warning = jest.spyOn(console, "warn").mockImplementation(() => {});
    SecureStore.getItemAsync.mockRejectedValue(new Error("keychain unavailable"));

    await expect(getItem(STORAGE_KEYS.REFRESH_TOKEN)).resolves.toBeNull();
    expect(warning).toHaveBeenCalledWith(
      `SecureStore getItem failed for ${STORAGE_KEYS.REFRESH_TOKEN}`,
      expect.any(Error)
    );
    warning.mockRestore();
  });
});
