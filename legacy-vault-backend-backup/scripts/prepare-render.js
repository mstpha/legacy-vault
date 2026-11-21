const { spawnSync } = require("child_process");
const path = require("path");

const backendDir = path.resolve(__dirname, "..");
const prismaCli = require.resolve("prisma");
const schemaPath = path.join(backendDir, "prisma", "schema.prisma");
const haSqlDir = path.resolve(backendDir, "..", "ha", "sql");
const aDirectUrl = process.env.DIRECT_URL;
const bDirectUrl = process.env.B_DIRECT_URL;

if (!process.env.DATABASE_URL || !process.env.B_DATABASE_URL || !aDirectUrl || !bDirectUrl) {
  throw new Error("DATABASE_URL, DIRECT_URL, B_DATABASE_URL, and B_DIRECT_URL must all be set before Render deploy.");
}
if (aDirectUrl === bDirectUrl) {
  throw new Error("DIRECT_URL and B_DIRECT_URL must point to separate Supabase databases.");
}

function runPrisma(args, directUrl) {
  const result = spawnSync(process.execPath, [prismaCli, ...args], {
    cwd: backendDir,
    env: {
      ...process.env,
      DATABASE_URL: directUrl,
      DIRECT_URL: directUrl,
    },
    stdio: "inherit",
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Prisma command failed (${args.join(" ")}) with exit code ${result.status}.`);
  }
}

function executeSql(directUrl, file) {
  runPrisma(
    ["db", "execute", "--schema", schemaPath, "--file", path.join(haSqlDir, file)],
    directUrl
  );
}

function executeStatement(directUrl, statement) {
  const result = spawnSync(
    process.execPath,
    [prismaCli, "db", "execute", "--schema", schemaPath, "--stdin"],
    {
      cwd: backendDir,
      env: {
        ...process.env,
        DATABASE_URL: directUrl,
        DIRECT_URL: directUrl,
      },
      input: statement,
      stdio: ["pipe", "inherit", "inherit"],
    }
  );

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Database initialization statement failed with exit code ${result.status}.`);
  }
}

for (const directUrl of [aDirectUrl, bDirectUrl]) {
  runPrisma(["migrate", "deploy", "--schema", schemaPath], directUrl);
  executeSql(directUrl, "001_ha_schema.sql");
}

executeStatement(aDirectUrl, "select ha.set_node('A');");
executeStatement(bDirectUrl, "select ha.set_node('B');");
executeSql(bDirectUrl, "002_b_only.sql");

console.log("Supabase database migrations and HA trigger setup completed for A and B.");
