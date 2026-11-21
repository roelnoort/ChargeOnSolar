import { describe, expect, it } from "vitest";
import { filterToDiff } from "./review-comments.ts";

const finding = (path: string, line: number) => ({
  path,
  line,
  body: `Finding on ${path}:${line}`,
});

// `git diff` output: one file, one hunk. New-side lines 10–14: 10 and 11 are
// context, 12 and 13 added, 14 context. The removed line has no new-side
// number.
const oneHunk = [
  "diff --git a/packages/server/src/storage/index.ts b/packages/server/src/storage/index.ts",
  "index 1111111..2222222 100644",
  "--- a/packages/server/src/storage/index.ts",
  "+++ b/packages/server/src/storage/index.ts",
  "@@ -10,4 +10,5 @@ export const createStorage = (file: string) => {",
  "   const db = open(file);",
  "   return {",
  "-    readings: () => db.select().from(readings),",
  "+    readings: (limit: number) =>",
  "+      db.select().from(readings).limit(limit),",
  "   };",
].join("\n");

describe("filterToDiff", () => {
  it("keeps a comment on an added line and drops one outside every hunk", () => {
    const result = filterToDiff(oneHunk, [
      finding("packages/server/src/storage/index.ts", 12),
      finding("packages/server/src/storage/index.ts", 40),
    ]);

    expect(result.kept).toEqual([
      finding("packages/server/src/storage/index.ts", 12),
    ]);
    expect(result.dropped).toEqual([
      finding("packages/server/src/storage/index.ts", 40),
    ]);
  });

  it("keeps comments on context lines, numbered past the removed line", () => {
    const { kept, dropped } = filterToDiff(oneHunk, [
      finding("packages/server/src/storage/index.ts", 10),
      finding("packages/server/src/storage/index.ts", 14),
      finding("packages/server/src/storage/index.ts", 15),
    ]);

    expect(kept.map(({ line }) => line)).toEqual([10, 14]);
    expect(dropped.map(({ line }) => line)).toEqual([15]);
  });

  it("drops a comment between two hunks of the same file", () => {
    const twoHunks = [
      "diff --git a/packages/shared/src/phase.ts b/packages/shared/src/phase.ts",
      "--- a/packages/shared/src/phase.ts",
      "+++ b/packages/shared/src/phase.ts",
      "@@ -1,2 +1,2 @@",
      "-export const phases = [1, 3];",
      "+export const phaseSettings = [1, 3] as const;",
      " ",
      "@@ -20,2 +20,3 @@ export const label = (phases: number) =>",
      "   phases === 1",
      "+    ? `1 phase`",
      "     : `3 phases`;",
    ].join("\n");

    const { kept, dropped } = filterToDiff(twoHunks, [
      finding("packages/shared/src/phase.ts", 1),
      finding("packages/shared/src/phase.ts", 10),
      finding("packages/shared/src/phase.ts", 21),
    ]);

    expect(kept.map(({ line }) => line)).toEqual([1, 21]);
    expect(dropped.map(({ line }) => line)).toEqual([10]);
  });

  it("matches each comment against its own file's hunks", () => {
    const twoFiles = [
      "diff --git a/packages/server/src/api/live.ts b/packages/server/src/api/live.ts",
      "--- a/packages/server/src/api/live.ts",
      "+++ b/packages/server/src/api/live.ts",
      "@@ -5,1 +5,2 @@",
      " app.get('/api/live', (c) => {",
      "+  const now = clock.now();",
      "diff --git a/packages/server/src/api/readings.ts b/packages/server/src/api/readings.ts",
      "--- a/packages/server/src/api/readings.ts",
      "+++ b/packages/server/src/api/readings.ts",
      "@@ -40,1 +40,2 @@",
      " app.get('/api/readings', async (c) => {",
      "+  const page = pageQuery.parse(c.req.query());",
    ].join("\n");

    const { kept, dropped } = filterToDiff(twoFiles, [
      finding("packages/server/src/api/live.ts", 6),
      finding("packages/server/src/api/live.ts", 41),
      finding("packages/server/src/api/readings.ts", 41),
      finding("packages/server/src/api/readings.ts", 6),
    ]);

    expect(kept).toEqual([
      finding("packages/server/src/api/live.ts", 6),
      finding("packages/server/src/api/readings.ts", 41),
    ]);
    expect(dropped).toEqual([
      finding("packages/server/src/api/live.ts", 41),
      finding("packages/server/src/api/readings.ts", 6),
    ]);
  });

  it("keeps comments on every line of a new file", () => {
    const newFile = [
      "diff --git a/CODING_STANDARDS.md b/CODING_STANDARDS.md",
      "new file mode 100644",
      "index 0000000..3333333",
      "--- /dev/null",
      "+++ b/CODING_STANDARDS.md",
      "@@ -0,0 +1,3 @@",
      "+# Coding standards",
      "+",
      "+## Inject the clock",
    ].join("\n");

    const { kept, dropped } = filterToDiff(newFile, [
      finding("CODING_STANDARDS.md", 1),
      finding("CODING_STANDARDS.md", 3),
      finding("CODING_STANDARDS.md", 4),
    ]);

    expect(kept.map(({ line }) => line)).toEqual([1, 3]);
    expect(dropped.map(({ line }) => line)).toEqual([4]);
  });

  it("drops comments on a deleted file, which has no new side", () => {
    const deletedFile = [
      "diff --git a/packages/server/src/old.ts b/packages/server/src/old.ts",
      "deleted file mode 100644",
      "--- a/packages/server/src/old.ts",
      "+++ /dev/null",
      "@@ -1,2 +0,0 @@",
      "-export const old = 1;",
      "-export const older = 2;",
    ].join("\n");

    const { kept, dropped } = filterToDiff(deletedFile, [
      finding("packages/server/src/old.ts", 1),
    ]);

    expect(kept).toEqual([]);
    expect(dropped).toEqual([finding("packages/server/src/old.ts", 1)]);
  });

  it("keeps nothing when the diff is empty", () => {
    const { kept, dropped } = filterToDiff("", [finding("README.md", 1)]);

    expect(kept).toEqual([]);
    expect(dropped).toEqual([finding("README.md", 1)]);
  });
});
