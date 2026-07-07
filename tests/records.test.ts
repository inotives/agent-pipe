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

function writeProjectYaml(projectDir: string, lines: string[]): void {
  fs.writeFileSync(path.join(projectDir, ".agent-pipe/project.yaml"), `${lines.join("\n")}\n`, "utf8");
}

function withDatabase(projectDir: string, fn: (database: Database.Database) => void, databaseName = "local"): void {
  const database = new Database(path.join(projectDir, `.agent-pipe/data/${databaseName}.sqlite`));
  try {
    fn(database);
  } finally {
    database.close();
  }
}

function insertRecord(
  projectDir: string,
  input: {
    id: string;
    entity: string;
    localId: string;
    source: string | null;
    updatedAt: string;
    deletedAt?: string | null;
    payload?: Record<string, unknown>;
    metadata?: Record<string, unknown> | null;
    databaseName?: string;
  },
): void {
  withDatabase(projectDir, (database) => {
    database
      .prepare(`
        insert into records (
          id, project_id, entity, local_id, source, captured_at, payload_json,
          metadata_json, created_at, updated_at, deleted_at
        ) values (
          @id, @project_id, @entity, @local_id, @source, @captured_at, @payload_json,
          @metadata_json, @created_at, @updated_at, @deleted_at
        )
      `)
      .run({
        id: input.id,
        project_id: "records-project",
        entity: input.entity,
        local_id: input.localId,
        source: input.source,
        captured_at: input.updatedAt,
        payload_json: JSON.stringify(input.payload ?? { id: input.localId }),
        metadata_json: input.metadata === null ? null : JSON.stringify(input.metadata ?? { origin: input.id }),
        created_at: input.updatedAt,
        updated_at: input.updatedAt,
        deleted_at: input.deletedAt ?? null,
      });
  }, input.databaseName);
}

function seedRecords(projectDir: string): void {
  runCli(projectDir, ["init"]);
  insertRecord(projectDir, {
    id: 'records-project:coins_list:["btc"]',
    entity: "coins_list",
    localId: '["btc"]',
    source: "coingecko_coins_list",
    updatedAt: "2026-07-05T12:00:00.000Z",
    payload: { id: "btc", symbol: "btc" },
    metadata: { fetchedAt: "2026-07-05T12:00:00.000Z" },
  });
  insertRecord(projectDir, {
    id: 'records-project:coins_markets:["eth"]',
    entity: "coins_markets",
    localId: '["eth"]',
    source: "coingecko_coins_markets",
    updatedAt: "2026-07-05T13:00:00.000Z",
    payload: { id: "eth", price: 100 },
    metadata: { fetchedAt: "2026-07-05T13:00:00.000Z" },
  });
  insertRecord(projectDir, {
    id: 'records-project:coins_list:["doge"]',
    entity: "coins_list",
    localId: '["doge"]',
    source: "manual_import",
    updatedAt: "2026-07-05T14:00:00.000Z",
    deletedAt: "2026-07-05T15:00:00.000Z",
    payload: { id: "doge", symbol: "doge" },
    metadata: null,
  });
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("agent-pipe records", () => {
  it("lists compact rows by updated_at desc and hides deleted rows by default", () => {
    const projectDir = makeTempProject("records-project");
    seedRecords(projectDir);

    const output = runCli(projectDir, ["records", "list"]).stdout.trimEnd().split("\n");

    expect(output[0]).toMatch(/^ID\s+ENTITY\s+SOURCE\s+UPDATED_AT$/);
    expect(output[1]).toContain('records-project:coins_markets:["eth"]');
    expect(output[1]).toContain("coins_markets");
    expect(output[1]).toContain("coingecko_coins_markets");
    expect(output[2]).toContain('records-project:coins_list:["btc"]');
    expect(output[2]).toContain("coins_list");
    expect(output.join("\n")).not.toContain('records-project:coins_list:["doge"]');
  });

  it("supports entity, source, limit, include-deleted, and json output", () => {
    const projectDir = makeTempProject("records-filters");
    seedRecords(projectDir);

    const entityTable = runCli(projectDir, ["records", "list", "--entity", "coins_markets"]).stdout.trim();
    expect(entityTable).toContain('records-project:coins_markets:["eth"]');
    expect(entityTable).not.toContain('records-project:coins_list:["btc"]');

    const sourceTable = runCli(projectDir, ["records", "list", "--source", "coingecko_coins_list"]).stdout.trim();
    expect(sourceTable).toContain('records-project:coins_list:["btc"]');
    expect(sourceTable).not.toContain('records-project:coins_markets:["eth"]');

    const limitedTable = runCli(projectDir, ["records", "list", "--limit", "1"]).stdout.trim().split("\n");
    expect(limitedTable).toHaveLength(2);
    expect(limitedTable[1]).toContain('records-project:coins_markets:["eth"]');

    const includeDeletedTable = runCli(projectDir, ["records", "list", "--include-deleted"]).stdout.trim();
    expect(includeDeletedTable).toContain('records-project:coins_list:["doge"]');

    const jsonOutput = JSON.parse(runCli(projectDir, ["records", "list", "--json", "--include-deleted"]).stdout) as Array<{
      id: string;
      entity: string;
      source: string | null;
      updated_at: string;
    }>;
    expect(jsonOutput).toEqual([
      {
        id: 'records-project:coins_list:["doge"]',
        entity: "coins_list",
        source: "manual_import",
        updated_at: "2026-07-05T14:00:00.000Z",
      },
      {
        id: 'records-project:coins_markets:["eth"]',
        entity: "coins_markets",
        source: "coingecko_coins_markets",
        updated_at: "2026-07-05T13:00:00.000Z",
      },
      {
        id: 'records-project:coins_list:["btc"]',
        entity: "coins_list",
        source: "coingecko_coins_list",
        updated_at: "2026-07-05T12:00:00.000Z",
      },
    ]);
  });

  it("prints only the header row for an empty table and [] for empty json", () => {
    const projectDir = makeTempProject("records-empty");
    runCli(projectDir, ["init"]);

    expect(runCli(projectDir, ["records", "list"]).stdout.trimEnd()).toBe(
      "ID  ENTITY  SOURCE  UPDATED_AT",
    );
    expect(JSON.parse(runCli(projectDir, ["records", "list", "--json"]).stdout)).toEqual([]);
  });

  it("shows one record as pretty json with parsed payload and metadata", () => {
    const projectDir = makeTempProject("records-show");
    seedRecords(projectDir);

    const output = JSON.parse(runCli(projectDir, ["records", "show", 'records-project:coins_markets:["eth"]']).stdout) as {
      id: string;
      project_id: string;
      entity: string;
      local_id: string;
      source: string | null;
      captured_at: string | null;
      payload: Record<string, unknown>;
      metadata: Record<string, unknown> | null;
      created_at: string;
      updated_at: string;
      deleted_at: string | null;
    };

    expect(output).toEqual({
      id: 'records-project:coins_markets:["eth"]',
      project_id: "records-project",
      entity: "coins_markets",
      local_id: '["eth"]',
      source: "coingecko_coins_markets",
      captured_at: "2026-07-05T13:00:00.000Z",
      payload: { id: "eth", price: 100 },
      metadata: { fetchedAt: "2026-07-05T13:00:00.000Z" },
      created_at: "2026-07-05T13:00:00.000Z",
      updated_at: "2026-07-05T13:00:00.000Z",
      deleted_at: null,
    });
  });

  it("fails clearly for invalid limits and unknown record ids", () => {
    const projectDir = makeTempProject("records-errors");
    seedRecords(projectDir);

    expect(() => runCli(projectDir, ["records", "list", "--limit", "0"])).toThrow(/--limit must be a positive integer/);
    expect(() => runCli(projectDir, ["records", "show", "missing-id"])).toThrow(/unknown record "missing-id"/);
  });

  it("reads from a selected configured database and defaults to local", () => {
    const projectDir = makeTempProject("records-database");
    runCli(projectDir, ["init"]);
    runCli(projectDir, ["db", "init"]);
    writeProjectYaml(projectDir, [
      "projectId: records-project",
      'projectName: "Records Project"',
      "defaultDatabase: local",
      "databases:",
      "  local:",
      "    type: sqlite",
      "    path: data/local.sqlite",
      "  research:",
      "    type: sqlite",
      "    path: data/research.sqlite",
    ]);
    runCli(projectDir, ["db", "init"]);
    insertRecord(projectDir, {
      id: 'records-project:coins_list:["btc"]',
      entity: "coins_list",
      localId: '["btc"]',
      source: "local_source",
      updatedAt: "2026-07-05T12:00:00.000Z",
      databaseName: "local",
    });
    insertRecord(projectDir, {
      id: 'records-project:coins_list:["eth"]',
      entity: "coins_list",
      localId: '["eth"]',
      source: "research_source",
      updatedAt: "2026-07-05T13:00:00.000Z",
      databaseName: "research",
    });

    const defaultList = runCli(projectDir, ["records", "list"]).stdout;
    const researchList = runCli(projectDir, ["records", "list", "--database", "research"]).stdout;
    const researchShow = JSON.parse(
      runCli(projectDir, ["records", "show", 'records-project:coins_list:["eth"]', "--database", "research"]).stdout,
    ) as { source: string | null };

    expect(defaultList).toContain('records-project:coins_list:["btc"]');
    expect(defaultList).not.toContain('records-project:coins_list:["eth"]');
    expect(researchList).toContain('records-project:coins_list:["eth"]');
    expect(researchList).not.toContain('records-project:coins_list:["btc"]');
    expect(researchShow.source).toBe("research_source");
  });

  it("fails clearly for unknown configured databases", () => {
    const projectDir = makeTempProject("records-unknown-db");
    seedRecords(projectDir);

    expect(() => runCli(projectDir, ["records", "list", "--database", "missing"])).toThrow(
      /unknown database "missing"/,
    );
    expect(() => runCli(projectDir, ["records", "show", 'records-project:coins_list:["btc"]', "--database", "missing"])).toThrow(
      /unknown database "missing"/,
    );
  });
});
