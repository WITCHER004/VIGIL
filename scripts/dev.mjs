import net from "net";
import path from "path";
import fs from "fs";
import { spawn } from "child_process";
import EmbeddedPostgres from "embedded-postgres";

const dataDir = path.resolve(process.cwd(), ".data/postgres");

function checkPort(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(1000);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => {
      resolve(false);
    });
    socket.connect(port, host);
  });
}

async function startEmbeddedDb() {
  const isInit = fs.existsSync(path.join(dataDir, "PG_VERSION"));
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "vigil",
    password: "vigil",
    port: 5433,
    persistent: true,
    autoRehydrateSymlinks: true,
  });

  if (!isInit) {
    console.log("[db] Initialising embedded PostgreSQL cluster in .data/postgres ...");
    await pg.initialise();
  }
  console.log("[db] Starting embedded PostgreSQL on port 5433 ...");
  await pg.start();

  try {
    await pg.createDatabase("vigil");
    console.log("[db] Database 'vigil' ready.");
  } catch (err) {
    // Database probably already exists
  }

  console.log("[db] PostgreSQL is ready at postgresql://vigil:vigil@localhost:5433/vigil");
  return pg;
}

async function main() {
  const isDbRunning = await checkPort(5433);
  let pgInstance = null;

  if (isDbRunning) {
    console.log("[db] PostgreSQL is already running on port 5433.");
  } else {
    try {
      pgInstance = await startEmbeddedDb();
    } catch (err) {
      console.error("[db] Failed to start embedded PostgreSQL:", err);
      process.exit(1);
    }
  }

  console.log("[app] Starting Next.js dev server...");
  const isWindows = process.platform === "win32";
  const cmd = isWindows ? "npx.cmd" : "npx";
  const nextChild = spawn(cmd, ["next", "dev"], {
    stdio: "inherit",
    shell: true,
  });

  const cleanup = async () => {
    if (nextChild) {
      nextChild.kill();
    }
    if (pgInstance) {
      console.log("\n[db] Stopping embedded PostgreSQL...");
      try {
        await pgInstance.stop();
      } catch (e) {
        // ignore on exit
      }
    }
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
  nextChild.on("exit", (code) => {
    cleanup();
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
