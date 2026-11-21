import * as path from "node:path";
import * as sandcastle from "@ai-hero/sandcastle";
import { noSandbox } from "@ai-hero/sandcastle/sandboxes/no-sandbox";
import { claudeAgent, writeJson } from "../shared/common.ts";
import { extractionPrompt } from "../shared/extraction-prompt.ts";
import { runWithExtraction } from "../shared/run-with-extraction.ts";
import { splitPlanSchema } from "./split-schema.ts";

// The agent reads the spec and the code, and hands back the tickets. It holds
// no GitHub token: the split-apply job checks the plan, then creates the
// sub-issues and their dependencies.
const result = await runWithExtraction({
  name: "split",
  agent: claudeAgent(),
  sandbox: noSandbox(),
  logging: { type: "stdout" },
  promptFile: path.join(import.meta.dirname, "split-prompt.md"),
  output: sandcastle.Output.object({ tag: "plan", schema: splitPlanSchema }),
  extractionPrompt: extractionPrompt("plan", splitPlanSchema),
});

writeJson("split-plan.json", result.output);
