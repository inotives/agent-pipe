import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import { ensureSupportedSchemaVersion } from "./init.js";
import { findProjectRoot } from "./project.js";

type RunsListOptions = {
  status?: string;
  jobId?: string;
  limit?: string | number;
  json?: boolean;
};

type RunSummary = {
  id: string;
  job_id: string;
  entity: string | null;
  status: string;
  records_written: number;
  started_at: string;
  finished_at: string | null;
};

type RunDetailsRow = RunSummary & {
  error_message: string | null;
  metadata_json: string | null;
};

export function runRunsList(cwd: string, options: RunsListOptions): string {
  const limit = parseLimit(options.limit);
  const database = openProjectDatabase(cwd);
  try {
    const rows = listRuns(database, {
      status: options.status,
      jobId: options.jobId,
      limit,
    });
    if (options.json) {
      return JSON.stringify(rows);
    }
    return formatRunsTable(rows);
  } finally {
    database.close();
  }
}

export function runRunsShow(cwd: string, id: string): string {
  const database = openProjectDatabase(cwd);
  try {
    const row = database
      .prepare(`
        select
          id,
          job_id,
          entity,
          status,
          started_at,
          finished_at,
          records_written,
          error_message,
          metadata_json
        from job_runs
        where id = ?
      `)
      .get(id) as RunDetailsRow | undefined;

    if (!row) {
      throw new Error(`unknown run "${id}"`);
    }

    return JSON.stringify(
      {
        id: row.id,
        job_id: row.job_id,
        entity: row.entity,
        status: row.status,
        started_at: row.started_at,
        finished_at: row.finished_at,
        records_written: row.records_written,
        error_message: row.error_message,
        metadata: row.metadata_json === null ? null : parseStoredJson(row.metadata_json),
      },
      null,
      2,
    );
  } finally {
    database.close();
  }
}

export function runRunsClearRunning(cwd: string, jobId: string): string {
  const database = openProjectDatabase(cwd, { readonly: false });
  try {
    const finishedAt = new Date().toISOString();
    const cleared = database
      .prepare(`
        update job_runs
        set status = 'failed',
            finished_at = ?,
            error_message = 'cleared running job by operator'
        where job_id = ?
          and status = 'running'
      `)
      .run(finishedAt, jobId).changes;

    return JSON.stringify({ jobId, cleared });
  } finally {
    database.close();
  }
}

function openProjectDatabase(cwd: string, options: { readonly?: boolean } = {}): Database.Database {
  const projectRoot = findProjectRoot(cwd);
  if (!projectRoot) {
    throw new Error("missing .agent-pipe project; run `agent-pipe init` first");
  }

  const databasePath = path.join(projectRoot, ".agent-pipe", "data", "local.sqlite");
  if (!fs.existsSync(databasePath)) {
    throw new Error("missing .agent-pipe/data/local.sqlite; run `agent-pipe init` first");
  }

  const database = new Database(databasePath, { readonly: options.readonly ?? true });
  ensureSupportedSchemaVersion(database);
  return database;
}

function parseLimit(value: string | number | undefined): number {
  if (value === undefined) {
    return 20;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("--limit must be a positive integer");
  }
  return parsed;
}

function listRuns(
  database: Database.Database,
  options: {
    status?: string;
    jobId?: string;
    limit: number;
  },
): RunSummary[] {
  const where: string[] = [];
  const params: Array<string | number> = [];

  if (options.status) {
    where.push("status = ?");
    params.push(options.status);
  }
  if (options.jobId) {
    where.push("job_id = ?");
    params.push(options.jobId);
  }

  const whereClause = where.length > 0 ? `where ${where.join(" and ")}` : "";
  return database
    .prepare(
      `
        select id, job_id, entity, status, records_written, started_at, finished_at
        from job_runs
        ${whereClause}
        order by started_at desc
        limit ?
      `,
    )
    .all(...params, options.limit) as RunSummary[];
}

function formatRunsTable(rows: RunSummary[]): string {
  const headers = ["ID", "JOB_ID", "ENTITY", "STATUS", "RECORDS_WRITTEN", "STARTED_AT", "FINISHED_AT"] as const;
  const tableRows = rows.map((row) => [
    row.id,
    row.job_id,
    row.entity ?? "",
    row.status,
    String(row.records_written),
    row.started_at,
    row.finished_at ?? "",
  ]);
  const widths = headers.map((header, index) => Math.max(header.length, ...tableRows.map((row) => row[index].length)));
  const formatRow = (row: readonly string[]) => row.map((value, index) => value.padEnd(widths[index])).join("  ").trimEnd();
  return `${formatRow(headers)}${tableRows.length > 0 ? `\n${tableRows.map((row) => formatRow(row)).join("\n")}` : ""}`;
}

function parseStoredJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error("invalid stored metadata_json");
  }
}
