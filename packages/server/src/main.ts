import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { systemClock } from "./clock.ts";
import { p1ClientFromEnv } from "./p1/from-env.ts";
import { assembleServer, dataFiles } from "./server.ts";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(process.env.DATA_DIR ?? resolve(here, "../data"));
const port = Number(process.env.PORT ?? 3000);
const webRoot = resolve(here, "../../web/dist");
const envFile = resolve(here, "../../../.env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

mkdirSync(dataDir, { recursive: true });
const server = await assembleServer({
  clock: systemClock,
  ...dataFiles(dataDir),
  log: (line) => console.log(line),
  p1Client: p1ClientFromEnv(process.env, systemClock),
  webRoot,
});

const http = serve({ fetch: server.app.fetch, port }, (info) => {
  console.log(`Listening on http://localhost:${info.port}`);
});

function shutDown() {
  http.close(() => {
    server.close().then(
      () => process.exit(0),
      (error: unknown) => {
        console.error(error);
        process.exit(1);
      }
    );
  });
  // Open live streams never end by themselves.
  if ("closeAllConnections" in http) http.closeAllConnections();
}
process.on("SIGINT", shutDown);
process.on("SIGTERM", shutDown);
