import client from "./client";

export const registerRequest = (payload) =>
  client.post("/auth/register", payload).then((r) => r.data);

export const loginRequest = (payload) =>
  client.post("/auth/login", payload).then((r) => r.data);

export const refreshRequest = (refreshToken) =>
  client.post("/auth/refresh", { refreshToken }).then((r) => r.data);

export const logoutRequest = (refreshToken) => client.post("/auth/logout", { refreshToken });

export const meRequest = () => client.get("/auth/me").then((r) => r.data.user);

export const mfaSetupRequest = () => client.post("/auth/mfa/setup").then((r) => r.data);

export const mfaConfirmRequest = (token) =>
  client.post("/auth/mfa/confirm", { token }).then((r) => r.data);

export const mfaDisableRequest = (token) =>
  client.post("/auth/mfa/disable", { token }).then((r) => r.data);

export const verifyEmailRequest = ({ email, code }) =>
  client
    .post("/auth/verify-email", { email, code })
    .then((response) => response.data);