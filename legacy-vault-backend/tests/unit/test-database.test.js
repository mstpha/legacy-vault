const { isDisposableTestDatabase } = require("../helpers/testDatabase");

describe("disposable database guard", () => {
  it("accepts a database explicitly named for testing", () => {
    expect(isDisposableTestDatabase("postgresql://localhost:5432/legacy_vault_test")).toBe(true);
  });

  it("accepts a dedicated Supabase URL tagged with the exact test application name", () => {
    expect(
      isDisposableTestDatabase(
        "postgresql://postgres.project:password@aws-1-eu-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true&application_name=legacy_vault_test"
      )
    ).toBe(true);
  });

  it("rejects untagged production-style database URLs", () => {
    expect(
      isDisposableTestDatabase(
        "postgresql://postgres.project:password@aws-1-eu-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true"
      )
    ).toBe(false);
    expect(isDisposableTestDatabase("not a database URL")).toBe(false);
    expect(isDisposableTestDatabase(undefined)).toBe(false);
  });

  it("does not mistake a different application name for the test marker", () => {
    expect(
      isDisposableTestDatabase(
        "postgresql://localhost:5432/postgres?application_name=legacy_vault_development"
      )
    ).toBe(false);
  });
});
