// Fails when the storage schema has changes that no migration covers yet:
// runs `drizzle-kit generate` against a copy of the migrations folder and
// checks it produced no new file. The real folder is never touched.
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import config from "../drizzle.config.ts";

const packageDir = fileURLToPath(new URL("..", import.meta.url));
const migrations = join(packageDir, "drizzle");
const copy = mkdtempSync(join(tmpdir(), "migration-drift-"));

function filesIn(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)))
    .sort();
}

try {
  cpSync(migrations, copy, { recursive: true });
  // drizzle-kit can exit 0 even when it fails, so its output decides.
  const output = execFileSync(
    "pnpm",
    [
      "exec",
      "drizzle-kit",
      "generate",
      `--dialect=${config.dialect}`,
      `--schema=${config.schema}`,
      // drizzle-kit mangles an absolute path here.
      `--out=${relative(packageDir, copy)}`,
    ],
    { cwd: packageDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );
  const before = new Set(filesIn(migrations));
  const added = filesIn(copy).filter((file) => !before.has(file));
  if (added.length > 0) {
    console.error(
      `Migration drift: the schema has changes no migration covers. Run \`pnpm --filter @charge-on-solar/server db:generate\` and commit the result. It would add:\n${added.map((file) => `  ${file}`).join("\n")}`
    );
    process.exitCode = 1;
  } else if (!output.includes("No schema changes")) {
    console.error(`drizzle-kit generate did not report its result:\n${output}`);
    process.exitCode = 1;
  } else {
    console.log("No migration drift.");
  }
} finally {
  rmSync(copy, { recursive: true, force: true });
}
