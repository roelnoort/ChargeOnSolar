import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { systemClock } from "./clock.ts";
import { enphaseSetupFromEnv } from "./enphase/from-env.ts";
import { mailerFromEnv } from "./mailer.ts";
import { p1ClientFromEnv } from "./p1/from-env.ts";
import { assembleServer, dataDirFromEnv, dataFiles } from "./server.ts";
import { mainFuseFromEnv, zaptecClientFromEnv } from "./zaptec/from-env.ts";

const here = dirname(fileURLToPath(import.meta.url));
const envFile = resolve(here, "../../../.env");
if (existsSync(envFile)) process.loadEnvFile(envFile);
const dataDir = dataDirFromEnv(process.env);
const port = Number(process.env.PORT ?? 3000);
const webRoot = resolve(here, "../../web/dist");

const log = (line: string) => console.log(line);
mkdirSync(dataDir, { recursive: true });
const server = await assembleServer({
  clock: systemClock,
  mailer: mailerFromEnv(process.env, log),
  ...dataFiles(dataDir),
  log,
  p1Client: p1ClientFromEnv(process.env, systemClock),
  zaptecClient: zaptecClientFromEnv(process.env, systemClock),
  mainFuseA: mainFuseFromEnv(process.env),
  enphase: enphaseSetupFromEnv(process.env),
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
