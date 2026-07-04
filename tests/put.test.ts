import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];
const repoRoot = path.resolve(__dirname, "..");
const tsxLoader = path.join(repoRoot, "node_modules/tsx/dist/loader.mjs");
const cliEntry = path.join(repoRoot, "src/index.ts");

function makeTempProject(name: string): string {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "agent-pipe-test-"));
  const dir = path.join(parent, name);
  fs.mkdirSync(dir, { recursive: true });
  tempDirs.push(parent);
  return dir;
}

function runCli(cwd: string, args: string[]): { stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, ["--import", tsxLoader, cliEntry, ...args], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { stdout, stderr: "" };
  } catch (error) {
    const failure = error as { stdout?: string | Buffer; stderr?: string | Buffer; message: string };
    throw new Error(
      [
        failure.message,
        typeof failure.stdout === "string" ? failure.stdout : failure.stdout?.toString("utf8") ?? "",
        typeof failure.stderr === "string" ? failure.stderr : failure.stderr?.toString("utf8") ?? "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
}

function writeJson(filePath: string, value: unknown): void {
  fs.writeFileSync(filePath, JSON.stringify(value), "utf8");
}

function readRecords(projectDir: string): Array<Record<string, unknown>> {
  const database = new Database(path.join(projectDir, ".agent-pipe/data/local.sqlite"), { readonly: true });
  try {
    return database
      .prepare("select id, project_id, entity, local_id, source, payload_json, metadata_json, deleted_at from records order by id")
      .all() as Array<Record<string, unknown>>;
  } finally {
    database.close();
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

describe("agent-pipe put", () => {
  it("writes deterministic IDs and is idempotent on rerun", () => {
    const projectDir = makeTempProject("alpha-project");
    runCli(projectDir, ["init"]);

    const inputPath = path.join(projectDir, "coins.json");
    writeJson(inputPath, [
      { id: "bitcoin", rank: 1, active: true },
      { id: "ethereum", rank: 2, active: false },
    ]);

    const first = JSON.parse(runCli(projectDir, ["put", "--entity", "coins_list", "--file", "./coins.json"]).stdout) as {
      projectId: string;
      entity: string;
      recordsWritten: number;
    };
    const second = JSON.parse(runCli(projectDir, ["put", "--entity", "coins_list", "--file", "./coins.json"]).stdout) as {
      recordsWritten: number;
    };

    const records = readRecords(projectDir);
    expect(first).toEqual({ projectId: "alpha-project", entity: "coins_list", recordsWritten: 2 });
    expect(second.recordsWritten).toBe(2);
    expect(records).toHaveLength(2);
    expect(records[0]?.id).toBe('alpha-project:coins_list:["bitcoin"]');
    expect(records[1]?.id).toBe('alpha-project:coins_list:["ethereum"]');
  });

  it("allows 0 and false id field values", () => {
    const projectDir = makeTempProject("falsy-project");
    runCli(projectDir, ["init"]);

    const inputPath = path.join(projectDir, "coins.json");
    writeJson(inputPath, [{ id: 0 }, { id: false }]);

    runCli(projectDir, ["put", "--entity", "coins_list", "--file", "./coins.json"]);

    const records = readRecords(projectDir);
    expect(records.map((row) => row.id)).toEqual([
      'falsy-project:coins_list:[0]',
      'falsy-project:coins_list:[false]',
    ]);
  });

  it("fails clearly for unknown entities", () => {
    const projectDir = makeTempProject("unknown-entity");
    runCli(projectDir, ["init"]);
    writeJson(path.join(projectDir, "coins.json"), [{ id: "bitcoin" }]);

    expect(() => runCli(projectDir, ["put", "--entity", "missing", "--file", "./coins.json"])).toThrow(
      /unknown entity "missing"; configured entities: coins_list/,
    );
  });

  it("fails clearly for invalid id field values", () => {
    const projectDir = makeTempProject("invalid-id-fields");
    runCli(projectDir, ["init"]);

    const cases: Array<{ label: string; payload: unknown; expected: RegExp }> = [
      { label: "missing", payload: [{}], expected: /missing id field "id"/ },
      { label: "null", payload: [{ id: null }], expected: /cannot be null/ },
      { label: "empty", payload: [{ id: "" }], expected: /cannot be empty/ },
      { label: "object", payload: [{ id: { nested: true } }], expected: /must be a scalar value/ },
      { label: "array", payload: [{ id: ["x"] }], expected: /must be a scalar value/ },
    ];

    for (const testCase of cases) {
      writeJson(path.join(projectDir, "coins.json"), testCase.payload);
      expect(() => runCli(projectDir, ["put", "--entity", "coins_list", "--file", "./coins.json"])).toThrow(
        testCase.expected,
      );
    }
  });

  it("uses projectId as part of record identity", () => {
    const firstProject = makeTempProject("first-project");
    const secondProject = makeTempProject("second-project");
    runCli(firstProject, ["init"]);
    runCli(secondProject, ["init"]);

    writeJson(path.join(firstProject, "coins.json"), [{ id: "bitcoin" }]);
    writeJson(path.join(secondProject, "coins.json"), [{ id: "bitcoin" }]);

    runCli(firstProject, ["put", "--entity", "coins_list", "--file", "./coins.json"]);
    runCli(secondProject, ["put", "--entity", "coins_list", "--file", "./coins.json"]);

    expect(readRecords(firstProject)[0]?.id).toBe('first-project:coins_list:["bitcoin"]');
    expect(readRecords(secondProject)[0]?.id).toBe('second-project:coins_list:["bitcoin"]');
  });
});
