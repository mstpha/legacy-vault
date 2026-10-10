import client from "./client";

export const listPermissionsRequest = () => client.get("/permissions").then((r) => r.data.permissions);

export const setPermissionRequest = (role, permission, enabled) =>
  client.patch(`/permissions/${role}/${permission}`, { enabled }).then((r) => r.data.permission);
