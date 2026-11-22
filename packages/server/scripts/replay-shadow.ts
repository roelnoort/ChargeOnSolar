// Prints the Shadow decisions a recorded Reading fixture produces, with the
// default settings: `pnpm --filter @charge-on-solar/server replay <file>`.
import { readFile } from "node:fs/promises";
import { argv, exit } from "node:process";
import {
  defaultShadowSettings,
  shadowRulesVersion,
} from "../src/domain/shadow/engine.ts";
import {
  parseReadings,
  replayReadings,
  summarizeReplay,
} from "../src/domain/shadow/replay.ts";

const file = argv[2];
if (!file) {
  console.error("Usage: replay <reading-fixture.json>");
  exit(1);
}

const readings = parseReadings(JSON.parse(await readFile(file, "utf8")));
console.log(`Shadow rules version ${shadowRulesVersion}`);
for (const line of summarizeReplay(
  replayReadings(readings, defaultShadowSettings)
)) {
  console.log(line);
}
