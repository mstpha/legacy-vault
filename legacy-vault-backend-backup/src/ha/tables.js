// The sync set, in foreign-key order (parents first). Upserts follow this order, deletes the
// reverse. Must match the trigger list in ha/sql/001_ha_schema.sql. Every table has a text `id` PK.
// Excluded on purpose: _prisma_migrations (schema is migrated on both projects), ha.change_log,
// ha.row_versions, ha.sync_audit, ha.settings (per-project bookkeeping).
const SYNCED_TABLES = [
  { schema: "public", table: "users" },
  { schema: "public", table: "role_permissions" },
  { schema: "public", table: "capsules" },
  { schema: "public", table: "capsule_files" },
  { schema: "public", table: "capsule_guarantors" },
  { schema: "public", table: "capsule_beneficiaries" },
  { schema: "public", table: "capsule_key_shares" },
  { schema: "public", table: "validations" },
  { schema: "public", table: "notifications" },
  { schema: "public", table: "refresh_tokens" },
  { schema: "public", table: "audit_logs" },
  { schema: "ha", table: "idempotency_keys" },
];

const qualified = (t) => `"${t.schema}"."${t.table}"`;

module.exports = { SYNCED_TABLES, qualified };
