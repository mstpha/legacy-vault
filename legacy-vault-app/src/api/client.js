import axios from "axios";
import * as Crypto from "expo-crypto";
import { HA_CONFIG } from "../config";
import { SERVERS, pickServer, markDown, markUp } from "./health";

// The ONE HTTP client of the app: every *.api.js module goes through it. Same surface as the axios
// instance it replaces (get/post/put/patch/delete -> axios response, errors are the original
// AxiosError, so `err.response?.data?.error?.message` keeps working everywhere).
//
// On top of axios it adds HA failover between the primary and the backup server:
//   - routing from the health store (health.js), no preflight per request
//   - network error / timeout / 502 / 503 / 504: mark the server down, retry it up to 2 times with
//     exponential backoff + jitter, then fail over to the other server and retry there
//   - 503 WITH Retry-After (backup's write pause during DRAINING, or an Idempotency-Key still in
//     progress): wait and retry the SAME server, without marking it down
//   - 4xx (and 500): never retried
//   - POST/PUT/PATCH/DELETE carry an Idempotency-Key, identical across every retry and the failover,
//     so a retried write is executed once (the servers replay the stored response)
//   - 401 -> one token refresh, then the request is replayed (unchanged from before)

const transport = axios.create();

// AuthContext registers real implementations of these at startup. Kept outside
// React so the client (module-level) can reach them without a
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

const WRITE_METHODS = new Set(["post", "put", "patch", "delete"]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const otherServer = (s) => (s === "primary" ? "backup" : "primary");

function newIdempotencyKey() {
  try {
    return Crypto.randomUUID();
  } catch (err) {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  }
}

function backoffDelay(attempt) {
  const base = HA_CONFIG.retryBaseDelayMs * 2 ** attempt;
  return base + Math.floor(Math.random() * base); // full jitter on top of the exponential step
}

function retryAfterMs(error) {
  const raw = error.response?.headers?.["retry-after"];
  const seconds = Number(raw);
  if (!Number.isNaN(seconds)) return Math.min(Math.max(seconds, 0.2) * 1000, 10000);
  const date = Date.parse(raw);
  return Number.isNaN(date) ? 1000 : Math.min(Math.max(date - Date.now(), 200), 10000);
}

// "retry-same": transient, the server asked us to come back. "server-down": fail over material.
// "final": the server answered; retrying cannot change the outcome.
function classify(error) {
  if (axios.isCancel(error)) return "final";
  if (!error.response) return "server-down"; // network error or timeout
  const status = error.response.status;
  if (status === 503 && error.response.headers?.["retry-after"] !== undefined) return "retry-same";
  if (status === 502 || status === 503 || status === 504) return "server-down";
  return "final";
}

async function send(server, config) {
  const headers = { ...(config.headers || {}) };
  const token = await handlers.getAccessToken();
  if (token && !headers.Authorization) headers.Authorization = `Bearer ${token}`;
  const response = await transport.request({
    ...config,
    baseURL: SERVERS[server].apiUrl,
    headers,
    timeout: config.timeout ?? HA_CONFIG.requestTimeoutMs,
  });
  markUp(server);
  return response;
}

// Retries / failover for one logical request (one Idempotency-Key).
async function requestWithFailover(config) {
  let server = await pickServer();
  let lastError;
  let waitedForRetryAfter = 0;

  for (let round = 0; round < 2; round++) {
    for (let attempt = 0; attempt <= HA_CONFIG.maxRetriesPerServer; ) {
      try {
        return await send(server, config);
      } catch (error) {
        lastError = error;
        const kind = classify(error);
        if (kind === "final") throw error;
        if (kind === "retry-same") {
          const wait = retryAfterMs(error);
          if (waitedForRetryAfter + wait > HA_CONFIG.retryAfterMaxTotalMs) throw error;
          waitedForRetryAfter += wait;
          await sleep(wait);
          continue; // does not consume a retry, does not mark the server down
        }
        markDown(server);
        if (attempt < HA_CONFIG.maxRetriesPerServer) await sleep(backoffDelay(attempt));
        attempt += 1;
      }
    }
    server = otherServer(server); // fail over and retry there
  }
  throw lastError;
}

// De-duplicates concurrent refresh attempts if several requests 401 at once.
let refreshPromise = null;

async function request(config) {
  const method = (config.method || "get").toLowerCase();
  const prepared = { ...config, method, headers: { ...(config.headers || {}) } };
  if (WRITE_METHODS.has(method) && !prepared.headers["Idempotency-Key"]) {
    prepared.headers["Idempotency-Key"] = newIdempotencyKey();
  }

  try {
    return await requestWithFailover(prepared);
  } catch (error) {
    const status = error.response?.status;
    const url = prepared.url || "";
    const isAuthEndpoint = url.includes("/auth/login") || url.includes("/auth/refresh");

    if (status === 401 && !prepared._retry && !isAuthEndpoint) {
      let newAccessToken;
      try {
        refreshPromise = refreshPromise || handlers.refreshTokens();
        newAccessToken = await refreshPromise;
        refreshPromise = null;
      } catch (refreshError) {
        refreshPromise = null;
        handlers.onAuthFailure();
        return Promise.reject(refreshError);
      }
      // Same Idempotency-Key: a 401 is never stored by the servers, so this is still one write.
      return requestWithFailover({
        ...prepared,
        _retry: true,
        headers: { ...prepared.headers, Authorization: `Bearer ${newAccessToken}` },
      });
    }
    throw error;
  }
}

const client = {
  request,
  get: (url, config = {}) => request({ ...config, url, method: "get" }),
  delete: (url, config = {}) => request({ ...config, url, method: "delete" }),
  head: (url, config = {}) => request({ ...config, url, method: "head" }),
  post: (url, data, config = {}) => request({ ...config, url, data, method: "post" }),
  put: (url, data, config = {}) => request({ ...config, url, data, method: "put" }),
  patch: (url, data, config = {}) => request({ ...config, url, data, method: "patch" }),
};

export default client;
