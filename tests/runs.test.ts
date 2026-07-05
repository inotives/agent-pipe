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

function withDatabase(projectDir: string, fn: (database: Database.Database) => void): void {
  const database = new Database(path.join(projectDir, ".agent-pipe/data/local.sqlite"));
  try {
    fn(database);
  } finally {
    database.close();
  }
}

function insertRun(
  projectDir: string,
  input: {
    id: string;
    jobId: string;
    entity: string | null;
    status: string;
    startedAt: string;
    finishedAt?: string | null;
    recordsWritten: number;
    errorMessage?: string | null;
    metadata?: Record<string, unknown> | null;
  },
): void {
  withDatabase(projectDir, (database) => {
    database
      .prepare(`
        insert into job_runs (
          id, job_id, entity, status, started_at, finished_at, records_written, error_message, metadata_json
        ) values (
          @id, @job_id, @entity, @status, @started_at, @finished_at, @records_written, @error_message, @metadata_json
        )
      `)
      .run({
        id: input.id,
        job_id: input.jobId,
        entity: input.entity,
        status: input.status,
        started_at: input.startedAt,
        finished_at: input.finishedAt ?? null,
        records_written: input.recordsWritten,
        error_message: input.errorMessage ?? null,
        metadata_json: input.metadata === null ? null : JSON.stringify(input.metadata ?? { sourceId: input.jobId }),
      });
  });
}

function seedRuns(projectDir: string): void {
  runCli(projectDir, ["init"]);
  insertRun(projectDir, {
    id: "run-1",
    jobId: "coingecko_coins_list",
    entity: "coins_list",
    status: "succeeded",
    startedAt: "2026-07-05T12:00:00.000Z",
    finishedAt: "2026-07-05T12:01:00.000Z",
    recordsWritten: 2,
    metadata: { sourceId: "coingecko_coins_list" },
  });
  insertRun(projectDir, {
    id: "run-2",
    jobId: "coingecko_coins_markets",
    entity: "coins_markets",
    status: "failed",
    startedAt: "2026-07-05T13:00:00.000Z",
    finishedAt: "2026-07-05T13:01:00.000Z",
    recordsWritten: 1,
    errorMessage: "request failed with status 429",
    metadata: { sourceId: "coingecko_coins_markets", page: 2 },
  });
  insertRun(projectDir, {
    id: "run-3",
    jobId: "coingecko_coins_list",
    entity: "coins_list",
    status: "running",
    startedAt: "2026-07-05T14:00:00.000Z",
    recordsWritten: 0,
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

describe("agent-pipe runs", () => {
  it("lists compact rows by started_at desc", () => {
    const projectDir = makeTempProject("runs-project");
    seedRuns(projectDir);

    const output = runCli(projectDir, ["runs", "list"]).stdout.trimEnd().split("\n");

    expect(output[0]).toMatch(/^ID\s+JOB_ID\s+ENTITY\s+STATUS\s+RECORDS_WRITTEN\s+STARTED_AT\s+FINISHED_AT$/);
    expect(output[1]).toContain("run-3");
    expect(output[1]).toContain("running");
    expect(output[2]).toContain("run-2");
    expect(output[2]).toContain("failed");
    expect(output[3]).toContain("run-1");
    expect(output[3]).toContain("succeeded");
  });

  it("supports status, job-id, limit, and json output", () => {
    const projectDir = makeTempProject("runs-filters");
    seedRuns(projectDir);

    const statusTable = runCli(projectDir, ["runs", "list", "--status", "failed"]).stdout.trim();
    expect(statusTable).toContain("run-2");
    expect(statusTable).not.toContain("run-1");

    const jobTable = runCli(projectDir, ["runs", "list", "--job-id", "coingecko_coins_list"]).stdout.trim();
    expect(jobTable).toContain("run-1");
    expect(jobTable).toContain("run-3");
    expect(jobTable).not.toContain("run-2");

    const limitedTable = runCli(projectDir, ["runs", "list", "--limit", "1"]).stdout.trim().split("\n");
    expect(limitedTable).toHaveLength(2);
    expect(limitedTable[1]).toContain("run-3");

    const jsonOutput = JSON.parse(runCli(projectDir, ["runs", "list", "--json"]).stdout) as Array<{
      id: string;
      job_id: string;
      entity: string | null;
      status: string;
      records_written: number;
      started_at: string;
      finished_at: string | null;
    }>;
    expect(jsonOutput).toEqual([
      {
        id: "run-3",
        job_id: "coingecko_coins_list",
        entity: "coins_list",
        status: "running",
        records_written: 0,
        started_at: "2026-07-05T14:00:00.000Z",
        finished_at: null,
      },
      {
        id: "run-2",
        job_id: "coingecko_coins_markets",
        entity: "coins_markets",
        status: "failed",
        records_written: 1,
        started_at: "2026-07-05T13:00:00.000Z",
        finished_at: "2026-07-05T13:01:00.000Z",
      },
      {
        id: "run-1",
        job_id: "coingecko_coins_list",
        entity: "coins_list",
        status: "succeeded",
        records_written: 2,
        started_at: "2026-07-05T12:00:00.000Z",
        finished_at: "2026-07-05T12:01:00.000Z",
      },
    ]);
  });

  it("prints only the header row for an empty table and [] for empty json", () => {
    const projectDir = makeTempProject("runs-empty");
    runCli(projectDir, ["init"]);

    expect(runCli(projectDir, ["runs", "list"]).stdout.trimEnd()).toBe(
      "ID  JOB_ID  ENTITY  STATUS  RECORDS_WRITTEN  STARTED_AT  FINISHED_AT",
    );
    expect(JSON.parse(runCli(projectDir, ["runs", "list", "--json"]).stdout)).toEqual([]);
  });

  it("shows one run as pretty json with parsed metadata", () => {
    const projectDir = makeTempProject("runs-show");
    seedRuns(projectDir);

    const output = JSON.parse(runCli(projectDir, ["runs", "show", "run-2"]).stdout) as {
      id: string;
      job_id: string;
      entity: string | null;
      status: string;
      started_at: string;
      finished_at: string | null;
      records_written: number;
      error_message: string | null;
      metadata: Record<string, unknown> | null;
    };

    expect(output).toEqual({
      id: "run-2",
      job_id: "coingecko_coins_markets",
      entity: "coins_markets",
      status: "failed",
      started_at: "2026-07-05T13:00:00.000Z",
      finished_at: "2026-07-05T13:01:00.000Z",
      records_written: 1,
      error_message: "request failed with status 429",
      metadata: { sourceId: "coingecko_coins_markets", page: 2 },
    });
  });

  it("fails clearly for invalid limits and unknown run ids", () => {
    const projectDir = makeTempProject("runs-errors");
    seedRuns(projectDir);

    expect(() => runCli(projectDir, ["runs", "list", "--limit", "0"])).toThrow(/--limit must be a positive integer/);
    expect(() => runCli(projectDir, ["runs", "show", "missing-run"])).toThrow(/unknown run "missing-run"/);
  });
});
