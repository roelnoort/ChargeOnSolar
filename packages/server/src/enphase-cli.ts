import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { systemClock } from "./clock.ts";
import { enphaseLoginFromEnv } from "./enphase/from-env.ts";
import { runEnphaseCommand } from "./enphase-command.ts";
import { dataDirFromEnv, dataFiles } from "./server.ts";
import { openStorage } from "./storage/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const envFile = resolve(here, "../../../.env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const login = enphaseLoginFromEnv(process.env);
if (!login) {
  console.error(
    "Set ENPHASE_CLIENT_ID, ENPHASE_CLIENT_SECRET and ENPHASE_TOKEN_KEY in .env first"
  );
  process.exit(1);
}
const dataDir = dataDirFromEnv(process.env);
if (!existsSync(dataDir)) {
  console.error(`No data directory at ${dataDir}: start the server once first`);
  process.exit(1);
}

const storage = await openStorage({
  ...dataFiles(dataDir),
  clock: systemClock,
  log: () => {},
});
try {
  const { exitCode, output } = await runEnphaseCommand(process.argv.slice(2), {
    storage,
    clock: systemClock,
    login,
  });
  for (const line of output) console.log(line);
  process.exitCode = exitCode;
} finally {
  await storage.close();
}
