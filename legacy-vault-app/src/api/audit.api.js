import client from "./client";

// Admin only (the server refuses everyone else).
// params: { before, group, capsuleId } -> { entries, nextCursor }
export const listAuditRequest = (params = {}) => client.get("/audit", { params }).then((r) => r.data);

// -> { valid, checked, legacyUnchained, brokenAt }
export const verifyAuditRequest = () => client.get("/audit/verify").then((r) => r.data);


