// Static consistency checks (no database). They exist because of a real Sprint 6 finding: the code
// created notifications of types that were missing from the Prisma enum, and the error was swallowed.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "../..");
const schema = fs.readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");

function enumValues(name) {
  const body = new RegExp(`enum ${name} \\{([^}]*)\\}`).exec(schema)[1];
  return body
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, "").trim())
    .filter(Boolean);
}

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? sourceFiles(full) : full.endsWith(".js") ? [full] : [];
  });
}
const sources = sourceFiles(path.join(root, "src")).map((f) => [f, fs.readFileSync(f, "utf8")]);

describe("NotificationType enum vs. code", () => {
  const declared = enumValues("NotificationType");

  it("every type passed to createNotification/notifyUsers exists in the Prisma enum", () => {
    const used = new Set();
    for (const [, text] of sources) {
      for (const m of text.matchAll(/(?:createNotification|notifyUsers)\([^"'`]*?,\s*"([A-Z_]+)"/g)) used.add(m[1]);
    }
    expect(used.size).toBeGreaterThan(5);
    expect([...used].filter((t) => !declared.includes(t))).toEqual([]);
  });

  it("every enum value has wording in notificationContent.js", () => {
    const content = fs.readFileSync(path.join(root, "src/utils/notificationContent.js"), "utf8");
    expect(declared.filter((t) => !content.includes(t))).toEqual([]);
  });

  it("every enum value is shipped by a migration", () => {
    const dir = path.join(root, "prisma/migrations");
    const sql = fs
      .readdirSync(dir)
      .filter((d) => fs.existsSync(path.join(dir, d, "migration.sql")))
      .map((d) => fs.readFileSync(path.join(dir, d, "migration.sql"), "utf8"))
      .join("\n");
    expect(declared.filter((t) => !sql.includes(`'${t}'`))).toEqual([]);
  });
});

describe("migrations", () => {
  it("every migration file is SQL (regression: one used to contain a PowerShell command)", () => {
    const dir = path.join(root, "prisma/migrations");
    for (const d of fs.readdirSync(dir)) {
      const file = path.join(dir, d, "migration.sql");
      if (!fs.existsSync(file)) continue;
      // Ignore SQL comments, then require real statements and no shell leftovers.
      const sql = fs.readFileSync(file, "utf8").replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      expect([d, /\b(ALTER|CREATE|DROP|INSERT|UPDATE|DELETE)\b/i.test(sql)]).toEqual([d, true]);
      expect([d, /Set-Content|^@'|^'@/m.test(sql)]).toEqual([d, false]);
    }
  });
});

describe("RM10 state machine", () => {
  it("the CapsuleState enum has exactly the 7 states of RM10", () => {
    expect(enumValues("CapsuleState")).toEqual([
      "DRAFT",
      "ACTIVE",
      "INACTIVITY_ALERT",
      "PENDING_VALIDATION",
      "UNLOCKED",
      "REVOKED",
      "ARCHIVED",
    ]);
  });
});
