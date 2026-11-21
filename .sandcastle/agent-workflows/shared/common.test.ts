import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { outputDir, writeJson } from "./common.ts";

describe("writeJson", () => {
  let dir: string;
  const previous = process.env.OUTPUT_DIR;

  beforeEach(() => {
    dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "factory-")), "out");
    process.env.OUTPUT_DIR = dir;
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.OUTPUT_DIR;
    else process.env.OUTPUT_DIR = previous;
  });

  it("writes the value as JSON into OUTPUT_DIR, creating it if missing", () => {
    writeJson("plan.json", { issues: [{ number: 7 }] });

    const written = fs.readFileSync(path.join(dir, "plan.json"), "utf8");
    expect(JSON.parse(written)).toEqual({ issues: [{ number: 7 }] });
  });
});

describe("outputDir", () => {
  const previous = process.env.OUTPUT_DIR;

  afterEach(() => {
    if (previous === undefined) delete process.env.OUTPUT_DIR;
    else process.env.OUTPUT_DIR = previous;
  });

  it("falls back to /tmp when OUTPUT_DIR is unset", () => {
    delete process.env.OUTPUT_DIR;
    expect(outputDir()).toBe("/tmp");
  });
});
