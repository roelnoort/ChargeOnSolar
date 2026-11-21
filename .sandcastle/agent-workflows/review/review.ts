import { execFileSync } from "node:child_process";
import * as path from "node:path";
import * as sandcastle from "@ai-hero/sandcastle";
import { noSandbox } from "@ai-hero/sandcastle/sandboxes/no-sandbox";
import { claudeAgent, required, writeJson } from "../shared/common.ts";
import { extractionPrompt } from "../shared/extraction-prompt.ts";
import { runWithExtraction } from "../shared/run-with-extraction.ts";
import { filterToDiff } from "./review-comments.ts";
import { reviewSchema } from "./review-schema.ts";

const BASE_REF = required("BASE_REF");

// The agent fixes and commits, writes the verdict file, and hands back the
// findings it left. It holds no GitHub token: the workflow pushes the commits,
// posts the verdict and the inline comments, and marks the PR ready.
const result = await runWithExtraction({
  name: "review",
  agent: claudeAgent(),
  sandbox: noSandbox(),
  logging: { type: "stdout" },
  promptFile: path.join(import.meta.dirname, "prompt.md"),
  promptArgs: {
    PR_NUMBER: required("PR_NUMBER"),
    BRANCH: required("BRANCH"),
    BASE_REF,
  },
  output: sandcastle.Output.object({ tag: "comments", schema: reviewSchema }),
  extractionPrompt: extractionPrompt("comments", reviewSchema),
});

const git = (...args: string[]): string =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

// The diff after the agent's commits: the comments land on that.
const { kept, dropped } = filterToDiff(
  git("diff", `origin/${BASE_REF}...HEAD`),
  result.output.comments
);
for (const { path: file, line } of dropped) {
  console.error(`Dropping the comment on ${file}:${line}: not in the diff.`);
}

// The request body for POST /repos/{owner}/{repo}/pulls/{n}/reviews.
writeJson("review-comments.json", {
  commit_id: git("rev-parse", "HEAD").trim(),
  event: "COMMENT",
  body: "The findings this review left for you, on their lines. The verdict is in its own comment.",
  comments: kept.map((comment) => ({ ...comment, side: "RIGHT" })),
});
