const prisma = require("../config/db");
const { ApiError } = require("../middleware/errorHandler");

const CACHE_TTL_MS = 60 * 1000;

let cache = null;
let cacheLoadedAt = 0;
let loading = null;
let cacheVersion = 0;

function invalidatePermissionCache() {
  cacheVersion += 1;
  cache = null;
  cacheLoadedAt = 0;
  loading = null;
}

async function loadPermissionCache() {
  if (cache && Date.now() - cacheLoadedAt < CACHE_TTL_MS) return cache;

  if (!loading) {
    const versionAtStart = cacheVersion;
    loading = prisma.rolePermission
      .findMany({ select: { role: true, permission: true, enabled: true } })
      .then((rows) => {
        const fresh = new Map(rows.map((r) => [`${r.role}:${r.permission}`, r.enabled]));
        // Only keep the result if nobody invalidated while we were loading.
        if (versionAtStart === cacheVersion) {
          cache = fresh;
          cacheLoadedAt = Date.now();
        }
        return fresh;
      })
      .finally(() => {
        if (versionAtStart === cacheVersion) loading = null;
      });
  }

  return loading;
}

// --- Human-friendly wording for error messages ------------------------------------

const ROLE_PLURALS = {
  TESTATOR: "testators",
  GUARANTOR: "guarantors",
  BENEFICIARY: "beneficiaries",
  ADMIN: "admins",
};

// Shown instead of the raw key like "capsule.create". Always a singular noun phrase,
// so the sentence "<name> is currently disabled for <role>s." reads correctly.
const PERMISSION_NAMES = {
  "capsule.create": "capsule creation",
  "capsule.edit_draft": "draft editing",
  "capsule.delete_draft": "draft deletion",
  "capsule.manage_members": "guarantor and beneficiary management",
  "capsule.manage_thresholds": "threshold management",
  "capsule.activate": "capsule activation",
  "capsule.revoke": "capsule revocation",
  "capsule.confirm_activity": "activity confirmation",
  "capsule.upload_file": "file uploading",
  "capsule.view_assigned": "viewing guaranteed capsules",
  "capsule.view_unlocked": "viewing unlocked capsules",
  "validation.submit": "capsule validation",
};

function describeBlocked(role, permission) {
  // Unknown keys fall back to a readable version of the key, e.g. "capsule view".
  const name = PERMISSION_NAMES[permission] || permission.replace(/[._]/g, " ");
  const plural = ROLE_PLURALS[role] || `${role.toLowerCase()}s`;
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} is currently disabled for ${plural}.`;
}

// --- Management page --------------------------------------------------------------

async function listPermissions() {
  const rows = await prisma.rolePermission.findMany({ orderBy: [{ role: "asc" }, { permission: "asc" }] });
  // Grouped by role for the management page: { TESTATOR: [...], GUARANTOR: [...], BENEFICIARY: [...] }
  return rows.reduce((acc, row) => {
    acc[row.role] = acc[row.role] || [];
    acc[row.role].push(row);
    return acc;
  }, {});
}

async function setPermission(role, permission, enabled) {
  const existing = await prisma.rolePermission.findUnique({
    where: { role_permission: { role, permission } },
  });
  if (!existing) throw new ApiError(404, `Unknown permission "${permission}" for role ${role}.`);

  const updated = await prisma.rolePermission.update({
    where: { role_permission: { role, permission } },
    data: { enabled },
  });

  invalidatePermissionCache();
  return updated;
}

// --- Enforcement ------------------------------------------------------------------

async function assertPermission(role, permission) {
  const permissions = await loadPermissionCache();
  const enabled = permissions.get(`${role}:${permission}`);

  // A missing row or a disabled row both mean "not allowed".
  if (!enabled) {
    throw new ApiError(403, describeBlocked(role, permission));
  }
}

// Non-throwing version for the app's pre-flight check: returns the permissions that
// are currently blocked for this role, with a ready-to-show message for each.
// Uses exactly the same rule as assertPermission, so the two can never disagree.
async function checkPermissions(role, permissions) {
  const map = await loadPermissionCache();
  return permissions
    .filter((permission) => !map.get(`${role}:${permission}`))
    .map((permission) => ({ permission, message: describeBlocked(role, permission) }));
}

module.exports = {
  listPermissions,
  setPermission,
  assertPermission,
  checkPermissions,
  invalidatePermissionCache,
};