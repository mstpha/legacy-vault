import axios from "axios";
import { API_BASE_URL } from "../config";

const client = axios.create({ baseURL: API_BASE_URL, timeout: 15000 });

// AuthContext registers real implementations of these at startup. Kept outside
// React so the interceptors below (module-level) can reach them without a
// circular import between client.js and AuthContext.js.
let handlers = {
  getAccessToken: async () => null,
  refreshTokens: async () => {
    throw new Error("refreshTokens handler not wired up yet");
  },
  onAuthFailure: () => {},
};

export function setAuthHandlers(next) {
  handlers = { ...handlers, ...next };
}

client.interceptors.request.use(async (reqConfig) => {
  const token = await handlers.getAccessToken();
  if (token) {
    reqConfig.headers.Authorization = `Bearer ${token}`;
  }
  return reqConfig;
});

// De-duplicates concurrent refresh attempts if several requests 401 at once.
let refreshPromise = null;

client.interceptors.response.use(
  (res) => res,
  async (error) => {
    const originalRequest = error.config;
    const status = error.response?.status;
    const isAuthEndpoint =
      originalRequest?.url?.includes("/auth/login") || originalRequest?.url?.includes("/auth/refresh");

    if (status === 401 && originalRequest && !originalRequest._retry && !isAuthEndpoint) {
      originalRequest._retry = true;
      try {
        refreshPromise = refreshPromise || handlers.refreshTokens();
        const newAccessToken = await refreshPromise;
        refreshPromise = null;
        originalRequest.headers = originalRequest.headers || {};
        originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
        return client(originalRequest);
      } catch (refreshError) {
        refreshPromise = null;
        handlers.onAuthFailure();
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

export default client;
