import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

import { buildCli } from "../src/cli.js";

const tempDirs: string[] = [];
const repoRoot = path.resolve(__dirname, "..");
const tsxLoader = path.join(repoRoot, "node_modules/tsx/dist/loader.mjs");
const cliEntry = path.join(repoRoot, "src/index.ts");

function makeTempProject(name: string): string {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "agent-pipe-jobs-list-"));
  const dir = path.join(parent, name);
  fs.mkdirSync(dir, { recursive: true });
  tempDirs.push(parent);
  return dir;
}

function runCli(cwd: string, args: string[]): { stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(
      process.execPath,
      ["--import", tsxLoader, cliEntry, ...args],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return { stdout, stderr: "" };
  } catch (error) {
    const failure = error as {
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      message: string;
    };
    return {
      stdout: typeof failure.stdout === "string" ? failure.stdout : failure.stdout?.toString("utf8") ?? "",
      stderr: typeof failure.stderr === "string" ? failure.stderr : failure.stderr?.toString("utf8") ?? "",
    };
  }
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("buildCli", () => {
  it("registers the phase 4 jobs command", () => {
    const program = buildCli();
    const jobs = program.commands.find((command) => command.name() === "jobs");

    expect(jobs?.commands.map((command) => command.name())).toEqual(["list"]);
  });
});

describe("agent-pipe jobs list", () => {
  it("prints a human-readable table with configured job ids, entity, and command", () => {
    const projectDir = makeTempProject("jobs-list-project");
    runCli(projectDir, ["init"]);
    fs.writeFileSync(
      path.join(projectDir, ".agent-pipe", "schedules.yaml"),
      [
        "entities:",
        "  coins_list:",
        "    idFields:",
        "      - id",
        "jobs:",
        "  collect_prices:",
        "    entity: coins_list",
        "    command: npm run collect:prices",
        "  collect_markets:",
        "    entity: coins_list",
        "    command: node ./scripts/collect-markets.mjs",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = runCli(projectDir, ["jobs", "list"]);

    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe(
      [
        "JOB_ID           ENTITY      COMMAND",
        "collect_prices   coins_list  npm run collect:prices",
        "collect_markets  coins_list  node ./scripts/collect-markets.mjs",
      ].join("\n"),
    );
  });

  it("prints JSON for configured jobs", () => {
    const projectDir = makeTempProject("jobs-list-json");
    fs.mkdirSync(path.join(projectDir, ".agent-pipe"), { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, ".agent-pipe", "schedules.yaml"),
      [
        "entities:",
        "  coins_list:",
        "    idFields:",
        "      - id",
        "jobs:",
        "  collect_prices:",
        "    entity: coins_list",
        "    command: npm run collect:prices",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = runCli(projectDir, ["jobs", "list", "--json"]);

    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual([
      { jobId: "collect_prices", entity: "coins_list", command: "npm run collect:prices" },
    ]);
  });

  it("treats existing jobs array compatibility config as empty", () => {
    const projectDir = makeTempProject("jobs-list-empty-array");
    fs.mkdirSync(path.join(projectDir, ".agent-pipe"), { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, ".agent-pipe", "schedules.yaml"),
      ["entities:", "  coins_list:", "    idFields:", "      - id", "jobs: []", ""].join("\n"),
      "utf8",
    );

    const tableResult = runCli(projectDir, ["jobs", "list"]);
    const jsonResult = runCli(projectDir, ["jobs", "list", "--json"]);

    expect(tableResult.stderr).toBe("");
    expect(tableResult.stdout.trim()).toBe("JOB_ID  ENTITY  COMMAND");
    expect(jsonResult.stderr).toBe("");
    expect(JSON.parse(jsonResult.stdout)).toEqual([]);
  });

  it("fails clearly when the project is not initialized", () => {
    const projectDir = makeTempProject("missing-project");

    const result = runCli(projectDir, ["jobs", "list"]);

    expect(result.stderr).toContain("missing .agent-pipe project; run `agent-pipe init` first");
  });

  it("fails clearly when schedules.yaml is missing or invalid", () => {
    const missingDir = makeTempProject("missing-schedules");
    runCli(missingDir, ["init"]);
    fs.rmSync(path.join(missingDir, ".agent-pipe", "schedules.yaml"));

    const missingResult = runCli(missingDir, ["jobs", "list"]);
    expect(missingResult.stderr).toContain("missing .agent-pipe/schedules.yaml; run `agent-pipe init` first");

    const invalidDir = makeTempProject("invalid-schedules");
    fs.mkdirSync(path.join(invalidDir, ".agent-pipe"), { recursive: true });
    fs.writeFileSync(path.join(invalidDir, ".agent-pipe", "schedules.yaml"), "not_jobs:\n  nope: true\n", "utf8");

    const invalidResult = runCli(invalidDir, ["jobs", "list"]);
    expect(invalidResult.stderr).toContain("invalid .agent-pipe/schedules.yaml");
  });

  it("fails clearly for invalid job config", () => {
    const projectDir = makeTempProject("invalid-job");
    fs.mkdirSync(path.join(projectDir, ".agent-pipe"), { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, ".agent-pipe", "schedules.yaml"),
      [
        "entities:",
        "  coins_list:",
        "    idFields:",
        "      - id",
        "jobs:",
        "  broken_job:",
        "    entity: missing_entity",
        "    command: npm run broken",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = runCli(projectDir, ["jobs", "list"]);

    expect(result.stderr).toContain('invalid job "broken_job": unknown entity "missing_entity"');
  });

  it("fails clearly for malformed job entries", () => {
    const projectDir = makeTempProject("malformed-job");
    fs.mkdirSync(path.join(projectDir, ".agent-pipe"), { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, ".agent-pipe", "schedules.yaml"),
      [
        "entities:",
        "  coins_list:",
        "    idFields:",
        "      - id",
        "jobs:",
        "  broken_job:",
        "    entity: coins_list",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = runCli(projectDir, ["jobs", "list"]);

    expect(result.stderr).toContain('invalid job "broken_job"');
  });
});
