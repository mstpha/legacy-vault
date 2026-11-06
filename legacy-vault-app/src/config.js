import { Platform } from "react-native";

// Sprint 6: the API address is now configurable without editing code.
//   1. Put EXPO_PUBLIC_PRIMARY_API_URL / EXPO_PUBLIC_BACKUP_API_URL in a `.env` file next to
//      package.json (Expo inlines EXPO_PUBLIC_* variables at build time; see .env.example), or
//   2. for production builds, set them to your deployed HTTPS API URLs.
// When they are not set, the previous development defaults apply. EXPO_PUBLIC_API_URL (pre-HA name)
// is still honoured as the primary URL.
//
// A physical phone cannot reach "localhost" on your computer: use the computer's LAN IP, and allow
// ports 4000/4001 through the Windows firewall.
const LOCAL_HOST = Platform.OS === "android" ? "192.168.1.116" : "localhost";

const num = (v, fallback) => (v !== undefined && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : fallback);

export const PRIMARY_API_URL =
  process.env.EXPO_PUBLIC_PRIMARY_API_URL || process.env.EXPO_PUBLIC_API_URL || `http://${LOCAL_HOST}:4000/api`;
export const BACKUP_API_URL = process.env.EXPO_PUBLIC_BACKUP_API_URL || `http://${LOCAL_HOST}:4001/api`;

// Kept for anything still importing the old name: it is the primary.
export const API_BASE_URL = PRIMARY_API_URL;

// HA failover tuning (src/api/health.js, src/api/client.js).
export const HA_CONFIG = {
  healthProbeIntervalMs: num(process.env.EXPO_PUBLIC_HEALTH_PROBE_INTERVAL_MS, 5000),
  healthTtlMs: num(process.env.EXPO_PUBLIC_HEALTH_TTL_MS, 10000),
  preflightTimeoutMs: num(process.env.EXPO_PUBLIC_PREFLIGHT_TIMEOUT_MS, 1000),
  requestTimeoutMs: num(process.env.EXPO_PUBLIC_REQUEST_TIMEOUT_MS, 15000),
  failbackHealthyProbes: num(process.env.EXPO_PUBLIC_FAILBACK_HEALTHY_PROBES, 3),
  maxRetriesPerServer: 2,
  retryBaseDelayMs: 250,
  retryAfterMaxTotalMs: 20000, // longest we keep waiting on 503 + Retry-After (write pause / in-progress key)
};

// GET /health lives at the server root, not under /api.
export const healthUrlFor = (apiUrl) => `${apiUrl.replace(/\/+$/, "").replace(/\/api$/, "")}/health`;
