const TEST_APPLICATION_NAME = "legacy_vault_test";

function isDisposableTestDatabase(connectionString) {
  if (typeof connectionString !== "string" || connectionString.length === 0) return false;

  try {
    const url = new URL(connectionString);
    if (!["postgres:", "postgresql:"].includes(url.protocol)) return false;

    const databaseName = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() || "");
    const applicationName = url.searchParams.get("application_name");

    return /test/i.test(databaseName) || applicationName === TEST_APPLICATION_NAME;
  } catch {
    return false;
  }
}

module.exports = { TEST_APPLICATION_NAME, isDisposableTestDatabase };
