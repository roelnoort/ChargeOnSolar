import { existsSync } from "node:fs";
import { systemClock } from "./clock.ts";
import { dataDirFromEnv, dataFiles } from "./server.ts";
import { openStorage } from "./storage/index.ts";
import { runUsersCommand } from "./users-command.ts";

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
  const { exitCode, output } = await runUsersCommand(process.argv.slice(2), {
    storage,
    clock: systemClock,
  });
  for (const line of output) console.log(line);
  process.exitCode = exitCode;
} finally {
  await storage.close();
}
