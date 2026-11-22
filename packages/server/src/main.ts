import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { systemClock } from "./clock.ts";
import { mailerFromEnv } from "./mailer.ts";
import { assembleServer, dataDirFromEnv, dataFiles } from "./server.ts";

const here = dirname(fileURLToPath(import.meta.url));
const envFile = resolve(here, "../.env");
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
}
process.on("SIGINT", shutDown);
process.on("SIGTERM", shutDown);
