import client from "./client";


export async function checkBlockedPermission(role, keys) {
  try {
    const { data } = await client.get("/permissions/check", {
      params: { role, keys: keys.join(",") },
    });
    return data.blocked?.[0]?.message || null;
  } catch (err) {
    return null;
  }
}