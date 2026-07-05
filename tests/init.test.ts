import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { buildCli } from "../src/cli.js";

const tempDirs: string[] = [];
const repoRoot = path.resolve(__dirname, "..");
const tsxLoader = path.join(repoRoot, "node_modules/tsx/dist/loader.mjs");
const cliEntry = path.join(repoRoot, "src/index.ts");
const expectedSourcesYaml = `sources:
  coingecko_coins_list:
    entity: coins_list
    type: api
    idFields:
      - id
    api:
      baseUrl: https://api.coingecko.com/api/v3
      endpoint: /coins/list
      method: GET
      query:
        include_platform: false
      payloadPath: $
      pagination:
        type: none
      rateLimit:
        minDelayMs: 10000

  coingecko_coins_markets:
    entity: coins_markets
    type: api
    idFields:
      - id
    api:
      baseUrl: https://api.coingecko.com/api/v3
      endpoint: /coins/markets
      method: GET
      query:
        vs_currency: usd
        per_page: 250
      payloadPath: $
      pagination:
        type: page
        pageParam: page
        perPageParam: per_page
        startPage: 1
        maxPages: 2
        stopWhen: empty_page
      rateLimit:
        minDelayMs: 10000

  coingecko_coin_history:
    entity: coin_history
    type: api
    idFields:
      - id
      - date
    api:
      baseUrl: https://api.coingecko.com/api/v3
      endpoint: /coins/{id}/history
      method: GET
      params:
        id: bitcoin
      query:
        date: 30-12-2025
        localization: false
      payloadPath: $
      pagination:
        type: none
      rateLimit:
        minDelayMs: 10000
`;

function makeTempProject(name: string): string {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "agent-pipe-test-"));
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

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("buildCli", () => {
  it("registers the current top-level commands", () => {
    const program = buildCli();
    const names = program.commands.map((command) => command.name());

    expect(names).toEqual(["init", "put", "source", "records", "runs"]);
  });
});

describe("agent-pipe init", () => {
  it("creates the expected project tree and sqlite schema", () => {
    const projectDir = makeTempProject("agent-pipe");
    const { stdout } = runCli(projectDir, ["init"]);
    const result = JSON.parse(stdout) as {
      projectId: string;
      projectName: string;
      paths: Record<string, string>;
    };

    expect(result.projectId).toBe("agent-pipe");
    expect(result.projectName).toBe("Agent Pipe");
    expect(result.paths.database).toBe(".agent-pipe/data/local.sqlite");

    expect(fs.existsSync(path.join(projectDir, ".agent-pipe/project.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, ".agent-pipe/schedules.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, ".agent-pipe/sources.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, ".agent-pipe/.env.local"))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, ".agent-pipe/logs"))).toBe(true);
    expect(fs.readFileSync(path.join(projectDir, ".agent-pipe/sources.yaml"), "utf8")).toBe(
      expectedSourcesYaml,
    );
    expect(fs.readFileSync(path.join(projectDir, ".agent-pipe/.env.local"), "utf8")).toBe(
      "# Local source credentials\n",
    );

    const database = new Database(path.join(projectDir, ".agent-pipe/data/local.sqlite"), {
      readonly: true,
    });

    try {
      const tables = database
        .prepare("select name from sqlite_master where type = 'table' order by name")
        .all() as Array<{ name: string }>;
      const recordColumns = database
        .prepare("pragma table_info(records)")
        .all() as Array<{ name: string }>;
      const jobRunColumns = database
        .prepare("pragma table_info(job_runs)")
        .all() as Array<{ name: string }>;
      const recordTableSql = database
        .prepare("select sql from sqlite_master where type = 'table' and name = 'records'")
        .get() as { sql: string } | undefined;
      const versions = database.prepare("select version from schema_migrations").all() as Array<{
        version: number;
      }>;

      expect(tables.map((row) => row.name)).toEqual(["job_runs", "records", "schema_migrations"]);
      expect(recordColumns.map((row) => row.name)).toEqual([
        "id",
        "project_id",
        "entity",
        "local_id",
        "source",
        "captured_at",
        "payload_json",
        "metadata_json",
        "created_at",
        "updated_at",
        "deleted_at",
      ]);
      expect(jobRunColumns.map((row) => row.name)).toEqual([
        "id",
        "job_id",
        "entity",
        "status",
        "started_at",
        "finished_at",
        "records_written",
        "error_message",
        "metadata_json",
      ]);
      expect(recordTableSql?.sql).toContain("unique (project_id, entity, local_id)");
      expect(versions).toEqual([{ version: 1 }]);
    } finally {
      database.close();
    }
  });

  it("is rerunnable without clobbering existing config", () => {
    const projectDir = makeTempProject("custom-project");
    fs.mkdirSync(path.join(projectDir, ".agent-pipe"), { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, ".agent-pipe/project.yaml"),
      "projectId: kept\nprojectName: \"Keep Me\"\n",
      "utf8",
    );
    fs.writeFileSync(path.join(projectDir, ".agent-pipe/sources.yaml"), "sources:\n  kept: true\n", "utf8");
    fs.writeFileSync(path.join(projectDir, ".agent-pipe/.env.local"), "COINGECKO_API_KEY=keep-me\n", "utf8");

    runCli(projectDir, ["init", "--project-id", "custom_project", "--project-name", "Ignored Name"]);

    expect(fs.readFileSync(path.join(projectDir, ".agent-pipe/project.yaml"), "utf8")).toBe(
      "projectId: kept\nprojectName: \"Keep Me\"\n",
    );
    expect(fs.readFileSync(path.join(projectDir, ".agent-pipe/sources.yaml"), "utf8")).toBe(
      "sources:\n  kept: true\n",
    );
    expect(fs.readFileSync(path.join(projectDir, ".agent-pipe/.env.local"), "utf8")).toBe(
      "COINGECKO_API_KEY=keep-me\n",
    );
    expect(fs.existsSync(path.join(projectDir, ".agent-pipe/data/local.sqlite"))).toBe(true);
  });

  it("fails clearly on unsupported schema versions", () => {
    const projectDir = makeTempProject("schema-check");
    fs.mkdirSync(path.join(projectDir, ".agent-pipe/data"), { recursive: true });
    const database = new Database(path.join(projectDir, ".agent-pipe/data/local.sqlite"));
    database.exec(`
      create table schema_migrations (version integer primary key);
      insert into schema_migrations (version) values (2);
    `);
    database.close();

    expect(() => runCli(projectDir, ["init"])).toThrow(/unsupported schema version: found 2/);
  });

  it("fails when nested inside another project", () => {
    const parentDir = makeTempProject("parent-project");
    const childDir = path.join(parentDir, "child");
    fs.mkdirSync(path.join(parentDir, ".agent-pipe"), { recursive: true });
    fs.mkdirSync(childDir, { recursive: true });

    expect(() => runCli(childDir, ["init"])).toThrow(/nested projects are not supported/);
  });
});
