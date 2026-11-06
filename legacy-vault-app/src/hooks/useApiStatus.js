import { useSyncExternalStore } from "react";
import { subscribe, getSnapshot } from "../api/health";

// Which server the app is talking to, for a status indicator.
//   { activeServer: "primary" | "backup",
//     backupDb: "A" | "B" | "draining" | null,
//     label: null | "Backup server" | "Backup server, degraded: backup database" | ...,
//     primary: { status, lastChecked, consecutiveFailures, ... },
//     backup:  { status, lastChecked, consecutiveFailures, db, outboxPending } }
export function useApiStatus() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
