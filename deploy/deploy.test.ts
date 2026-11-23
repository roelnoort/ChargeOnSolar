import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const script = path.join(import.meta.dirname, "deploy.sh");
const fakes = path.join(import.meta.dirname, "test-fakes");

const running = "1111111111111111111111111111111111111111";
const older = "2222222222222222222222222222222222222222";
const mainHead = "3333333333333333333333333333333333333333";
const unmerged = "4444444444444444444444444444444444444444";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-"));
  fs.mkdirSync(path.join(dir, "fake"));
  fs.mkdirSync(path.join(dir, "project"));
  write("main", [older, running, mainHead]);
  write("other", [unmerged]);
  write("head", [running]);
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function write(file: string, lines: string[]) {
  fs.writeFileSync(path.join(dir, "fake", file), `${lines.join("\n")}\n`);
}

function read(file: string): string[] {
  const filePath = path.join(dir, "fake", file);
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, "utf8").split("\n").filter(Boolean);
}

const checkedOut = () => read("head")[0];
const builds = () => read("builds");
const calls = () => read("calls");

type Result = { code: number | null; output: string };

function deploy(
  request: string | undefined,
  env: Record<string, string> = {}
): Promise<Result> {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", [script], {
      env: {
        PATH: `${fakes}:${process.env.PATH}`,
        FAKE_DIR: path.join(dir, "fake"),
        DEPLOY_PROJECT_DIR: path.join(dir, "project"),
        DEPLOY_LOCK: path.join(dir, "deploy.lock"),
        DEPLOY_WAIT_SECONDS: "0",
        ...(request === undefined ? {} : { SSH_ORIGINAL_COMMAND: request }),
        ...env,
      },
    });
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

async function until(condition: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function deadPid(): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn("true");
    child.on("error", reject);
    child.on("close", () => {
      if (child.pid === undefined) reject(new Error("No pid"));
      else resolve(child.pid);
    });
  });
}

describe("deploy", () => {
  it("deploys the given SHA", async () => {
    const result = await deploy(`deploy ${older}`);

    expect(result.code).toBe(0);
    expect(checkedOut()).toBe(older);
    expect(builds()).toEqual([older]);
    expect(result.output).toContain(`Deployed ${older}`);
  });

  it("deploys the head of main when no SHA is given", async () => {
    const result = await deploy("deploy");

    expect(result.code).toBe(0);
    expect(checkedOut()).toBe(mainHead);
    expect(builds()).toEqual([mainHead]);
    expect(result.output).toContain(`Deployed ${mainHead}`);
  });

  it("refuses a SHA that isn't on main, and builds nothing", async () => {
    const result = await deploy(`deploy ${unmerged}`);

    expect(result.code).not.toBe(0);
    expect(checkedOut()).toBe(running);
    expect(builds()).toEqual([]);
    expect(result.output).toContain(`${unmerged} is not a commit on main`);
  });

  it("refuses a SHA that doesn't exist, and builds nothing", async () => {
    const unknown = "5555555555555555555555555555555555555555";
    const result = await deploy(`deploy ${unknown}`);

    expect(result.code).not.toBe(0);
    expect(builds()).toEqual([]);
    expect(result.output).toContain(`${unknown} is not a commit on main`);
  });

  it("rolls back to the previous commit when the build fails", async () => {
    write("broken", [mainHead]);

    const result = await deploy("deploy");

    expect(result.code).not.toBe(0);
    expect(checkedOut()).toBe(running);
    expect(builds()).toEqual([mainHead, running]);
    expect(result.output).toContain(
      `Rolled back to ${running}: ${mainHead} could not be checked out or built.`
    );
  });

  it.each([
    ["restarts", "dying"],
    ["exits", "exiting"],
  ])(
    "rolls back to the previous commit when the container %s",
    async (_, failure) => {
      write(failure, [mainHead]);

      const result = await deploy("deploy");

      expect(result.code).not.toBe(0);
      expect(checkedOut()).toBe(running);
      expect(builds()).toEqual([mainHead, running]);
      expect(result.output).toContain(
        `Rolled back to ${running}: the container of ${mainHead} stopped or restarted within 0 s.`
      );
    }
  );

  it("says so when the rollback fails too", async () => {
    write("broken", [mainHead, running]);

    const result = await deploy("deploy");

    expect(result.code).not.toBe(0);
    expect(checkedOut()).toBe(running);
    expect(result.output).not.toContain("Rolled back to");
    expect(result.output).toContain(
      `Rollback to ${running} failed too: ChargeOnSolar may be down.`
    );
  });

  it("prunes dangling images and build cache after a successful deploy", async () => {
    await deploy("deploy");

    expect(calls().slice(-2)).toEqual([
      "docker image prune --force",
      "docker builder prune --force",
    ]);
  });

  it("still reports the deploy when pruning fails", async () => {
    write("prune-fails", ["yes"]);

    const result = await deploy("deploy");

    expect(result.code).toBe(0);
    expect(result.output).toContain("Warning: pruning failed");
    expect(result.output).toContain(`Deployed ${mainHead}`);
  });

  it.each([
    ["the build fails", "broken"],
    ["the container dies", "dying"],
  ])("doesn't prune when %s", async (_, failure) => {
    write(failure, [mainHead]);

    await deploy("deploy");

    expect(calls().filter((call) => call.includes("prune"))).toEqual([]);
  });

  it("refuses to run alongside a deploy that is already running", async () => {
    write("up-delay", ["1"]);
    const first = deploy("deploy");
    await until(() => builds().length > 0);

    const second = await deploy(`deploy ${older}`);
    const firstResult = await first;

    expect(second.code).not.toBe(0);
    expect(second.output).toContain("Refused: another deploy is running");
    expect(firstResult.code).toBe(0);
    expect(builds()).toEqual([mainHead]);
    expect(checkedOut()).toBe(mainHead);
  });

  it("runs once the previous deploy has finished", async () => {
    await deploy(`deploy ${older}`);

    const result = await deploy("deploy");

    expect(result.code).toBe(0);
    expect(builds()).toEqual([older, mainHead]);
  });

  it("runs when a deploy that is no longer running left its lock behind", async () => {
    const lock = path.join(dir, "deploy.lock");
    fs.mkdirSync(lock);
    fs.writeFileSync(path.join(lock, "pid"), `${await deadPid()}\n`);

    const result = await deploy("deploy");

    expect(result.code).toBe(0);
    expect(builds()).toEqual([mainHead]);
  });

  it.each([
    ["a shell", "bash"],
    ["a chained command", "deploy; rm -rf /"],
    ["a SHA with a chained command", `deploy ${older}; rm -rf /`],
    ["a second line", `deploy ${older}\nrm -rf /`],
    ["a SHA that isn't hex", "deploy main"],
    ["a SHA that is too short", "deploy 222222"],
    ["a SHA that is too long", `deploy ${older}0`],
    ["an uppercase SHA", `deploy ${older.replaceAll("2", "A")}`],
    ["a second argument", `deploy ${older} ${mainHead}`],
    ["a leading space", ` deploy ${older}`],
    ["an empty command", ""],
    ["no command at all", undefined],
  ])("refuses %s without touching git or docker", async (_, request) => {
    const result = await deploy(request);

    expect(result.code).not.toBe(0);
    expect(calls()).toEqual([]);
    expect(result.output).toContain("Refused");
  });
});
