// Helpers for the tests that run the deploy folder's shell scripts through
// their command line.
import { spawn } from "node:child_process";

export type Result = { code: number | null; output: string };

/** Runs a script with bash and only the given environment; output is stdout and stderr together. */
export function runScript(
  script: string,
  env: Record<string, string | undefined>
): Promise<Result> {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", [script], { env });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, output }));
  });
}

export async function until(condition: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
