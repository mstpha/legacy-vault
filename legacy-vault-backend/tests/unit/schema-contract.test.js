const fs = require("fs");
const path = require("path");
const { describeNotification } = require("../../src/utils/notificationContent");

const root = path.join(__dirname, "../..");
const schema = fs.readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");

function enumValues(name) {
  const match = new RegExp(`enum ${name} \\{([^}]*)\\}`).exec(schema);
  expect(match).not.toBeNull();
  return match[1]
    .replace(/\/\/.*$/gm, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function readMigrations() {
  const directory = path.join(root, "prisma/migrations");
  return fs
    .readdirSync(directory)
    .map((name) => path.join(directory, name, "migration.sql"))
    .filter((file) => fs.existsSync(file))
    .map((file) => fs.readFileSync(file, "utf8"))
    .join("\n")
    .replace(/--.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("Prisma schema contracts", () => {
  it("ships every notification enum value in migrations and notification content", () => {
    const values = enumValues("NotificationType");
    const migrations = readMigrations();
    const cases = fs.readFileSync(path.join(root, "src/utils/notificationContent.js"), "utf8");

    expect(values.length).toBeGreaterThan(5);
    expect(values.filter((value) => !migrations.includes(`'${value}'`))).toEqual([]);
    expect(values.filter((value) => !cases.includes(`case "${value}":`))).toEqual([]);

    for (const value of values) {
      const content = describeNotification(value);
      expect(content.subject).toEqual(expect.any(String));
      expect(content.title).toEqual(expect.any(String));
      expect(content.message).toEqual(expect.any(String));
    }
  });

  it("keeps the RM10 capsule state machine and valid SQL migrations", () => {
    expect(enumValues("CapsuleState")).toEqual([
      "DRAFT",
      "ACTIVE",
      "INACTIVITY_ALERT",
      "PENDING_VALIDATION",
      "UNLOCKED",
      "REVOKED",
      "ARCHIVED",
    ]);

    const directory = path.join(root, "prisma/migrations");
    for (const name of fs.readdirSync(directory)) {
      const file = path.join(directory, name, "migration.sql");
      if (!fs.existsSync(file)) continue;
      const sql = fs.readFileSync(file, "utf8").replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

      expect(sql).toMatch(/\b(ALTER|CREATE|DROP|INSERT|UPDATE|DELETE)\b/i);
      expect(sql).not.toMatch(/Set-Content|^@'|^'@/m);
    }
  });
});
