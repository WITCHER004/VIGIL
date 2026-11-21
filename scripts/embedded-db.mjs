import EmbeddedPostgres from "embedded-postgres";
import fs from "fs";
import path from "path";

const dataDir = path.resolve(process.cwd(), ".data/postgres");

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: "vigil",
  password: "vigil",
  port: 5433,
  persistent: true,
  autoRehydrateSymlinks: true,
});

async function main() {
  const isInit = fs.existsSync(path.join(dataDir, "PG_VERSION"));
  if (!isInit) {
    console.log("[db] Initialising embedded PostgreSQL cluster in .data/postgres ...");
    await pg.initialise();
  }
  console.log("[db] Starting PostgreSQL on port 5433 ...");
  await pg.start();
  
  try {
    await pg.createDatabase("vigil");
    console.log("[db] Database 'vigil' created.");
  } catch (err) {
    // Database probably already exists
  }

  console.log("[db] PostgreSQL is running at postgresql://vigil:vigil@localhost:5433/vigil");

  // Keep process alive
  process.on("SIGINT", async () => {
    console.log("[db] Stopping PostgreSQL ...");
    await pg.stop();
    process.exit(0);
  });
  process.on("SIGTERM", async () => {
    console.log("[db] Stopping PostgreSQL ...");
    await pg.stop();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("[db] Error starting embedded Postgres:", err);
  process.exit(1);
});
