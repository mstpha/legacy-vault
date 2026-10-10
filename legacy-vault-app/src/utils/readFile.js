import * as FileSystem from "expo-file-system/legacy";
import * as NewFS from "expo-file-system";

export const formatSize = (bytes) => {
  if (!bytes) return "";
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

// fetch + FileReader: bypasses expo-file-system's path permission check entirely.
export const readViaFetch = async (uri) => {
  const blob = await (await fetch(uri)).blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(reader.error || new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
};

// Reads a picked file as base64, trying several strategies until one works.
export async function readAsBase64(uri) {
  const strategies = [
    () => new NewFS.File(uri).base64(), // new API (SDK 54+)
    () => readViaFetch(uri),
    () => FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 }),
  ];

  let lastError;
  for (const attempt of strategies) {
    try {
      const result = await attempt();
      if (result) return result;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError || new Error("Could not read file");
}
