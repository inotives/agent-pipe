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
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "agent-pipe-source-list-"));
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
  it("registers the phase 2 source command", () => {
    const program = buildCli();
    const source = program.commands.find((command) => command.name() === "source");

    expect(source?.commands.map((command) => command.name())).toEqual(["list", "run"]);
  });
});

describe("agent-pipe source list", () => {
  it("prints a human-readable table with configured source ids, entity, and type", () => {
    const projectDir = makeTempProject("source-list-project");
    runCli(projectDir, ["init"]);

    const result = runCli(projectDir, ["source", "list"]);

    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe(
      [
        "SOURCE ID                ENTITY         TYPE",
        "coingecko_coins_list     coins_list     api",
        "coingecko_coins_markets  coins_markets  api",
        "coingecko_coin_history   coin_history   api",
      ].join("\n"),
    );
  });

  it("prints JSON and ignores unrelated invalid nested source fields", () => {
    const projectDir = makeTempProject("source-list-json");
    fs.mkdirSync(path.join(projectDir, ".agent-pipe"), { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, ".agent-pipe", "sources.yaml"),
      [
        "sources:",
        "  smoke_source:",
        "    entity: smoke",
        "    type: api",
        "    api:",
        "      unsupported:",
        "        nested:",
        "          - still",
        "          - ignored",
        "  incomplete_source:",
        "    api:",
        "      foo: bar",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = runCli(projectDir, ["source", "list", "--json"]);

    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual([
      { sourceId: "smoke_source", entity: "smoke", type: "api" },
      { sourceId: "incomplete_source", entity: "unknown", type: "unknown" },
    ]);
  });

  it("parses quoted YAML scalars for entity and type", () => {
    const projectDir = makeTempProject("quoted-source-list");
    fs.mkdirSync(path.join(projectDir, ".agent-pipe"), { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, ".agent-pipe", "sources.yaml"),
      [
        "sources:",
        "  quoted_source:",
        "    entity: 'coin history'",
        '    type: "api"',
        "",
      ].join("\n"),
      "utf8",
    );

    const result = runCli(projectDir, ["source", "list", "--json"]);

    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual([
      { sourceId: "quoted_source", entity: "coin history", type: "api" },
    ]);
  });

  it("ignores inline YAML comments in source summary fields", () => {
    const projectDir = makeTempProject("commented-source-list");
    fs.mkdirSync(path.join(projectDir, ".agent-pipe"), { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, ".agent-pipe", "sources.yaml"),
      [
        "sources:",
        "  commented_source:",
        "    entity: market data # shown to humans",
        '    type: "api" # transport type',
        "",
      ].join("\n"),
      "utf8",
    );

    const result = runCli(projectDir, ["source", "list", "--json"]);

    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual([
      { sourceId: "commented_source", entity: "market data", type: "api" },
    ]);
  });

  it("fails clearly when the project is not initialized", () => {
    const projectDir = makeTempProject("missing-project");

    const result = runCli(projectDir, ["source", "list"]);

    expect(result.stderr).toContain("missing .agent-pipe project; run `agent-pipe init` first");
  });

  it("fails clearly when sources.yaml is missing or invalid", () => {
    const missingDir = makeTempProject("missing-sources");
    runCli(missingDir, ["init"]);
    fs.rmSync(path.join(missingDir, ".agent-pipe", "sources.yaml"));

    const missingResult = runCli(missingDir, ["source", "list"]);
    expect(missingResult.stderr).toContain("missing .agent-pipe/sources.yaml; run `agent-pipe init` first");

    const invalidDir = makeTempProject("invalid-sources");
    fs.mkdirSync(path.join(invalidDir, ".agent-pipe"), { recursive: true });
    fs.writeFileSync(path.join(invalidDir, ".agent-pipe", "sources.yaml"), "not_sources:\n  nope: true\n", "utf8");

    const invalidResult = runCli(invalidDir, ["source", "list"]);
    expect(invalidResult.stderr).toContain("invalid .agent-pipe/sources.yaml");

    const malformedDir = makeTempProject("malformed-sources");
    fs.mkdirSync(path.join(malformedDir, ".agent-pipe"), { recursive: true });
    fs.writeFileSync(
      path.join(malformedDir, ".agent-pipe", "sources.yaml"),
      'sources:\n  broken_source:\n    entity: "unterminated\n',
      "utf8",
    );

    const malformedResult = runCli(malformedDir, ["source", "list"]);
    expect(malformedResult.stderr).toContain("invalid .agent-pipe/sources.yaml");

    const reviewerReproDir = makeTempProject("reviewer-repro");
    fs.mkdirSync(path.join(reviewerReproDir, ".agent-pipe"), { recursive: true });
    fs.writeFileSync(
      path.join(reviewerReproDir, ".agent-pipe", "sources.yaml"),
      "sources:\n  bad_source:\n    entity: [broken\n    type: api\n",
      "utf8",
    );

    const reviewerReproResult = runCli(reviewerReproDir, ["source", "list", "--json"]);
    expect(reviewerReproResult.stderr).toContain("invalid .agent-pipe/sources.yaml");
  });
});
