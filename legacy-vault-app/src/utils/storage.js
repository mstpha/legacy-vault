import * as SecureStore from "expo-secure-store";

export const STORAGE_KEYS = {
  ACCESS_TOKEN: "legacyvault.accessToken",
  REFRESH_TOKEN: "legacyvault.refreshToken",
};

export async function getItem(key) {
  try {
    return await SecureStore.getItemAsync(key);
  } catch (err) {
    console.warn(`SecureStore getItem failed for ${key}`, err);
    return null;
  }
}

export async function setItem(key, value) {
  try {
    await SecureStore.setItemAsync(key, value);
  } catch (err) {
    console.warn(`SecureStore setItem failed for ${key}`, err);
  }
}

export async function deleteItem(key) {
  try {
    await SecureStore.deleteItemAsync(key);
  } catch (err) {
    console.warn(`SecureStore deleteItem failed for ${key}`, err);
  }
}
