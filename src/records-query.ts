import path from "node:path";

import Database from "better-sqlite3";

import { findProjectRoot } from "./project.js";
import { ensureSupportedSchemaVersion, resolveProjectDatabase } from "./runtime.js";

type RecordsListOptions = {
  database?: string;
  entity?: string;
  source?: string;
  limit?: string | number;
  includeDeleted?: boolean;
  json?: boolean;
};

type RecordSummary = {
  id: string;
  entity: string;
  source: string | null;
  updated_at: string;
};

type RecordDetailsRow = {
  id: string;
  project_id: string;
  entity: string;
  local_id: string;
  source: string | null;
  captured_at: string | null;
  payload_json: string;
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export function runRecordsList(cwd: string, options: RecordsListOptions): string {
  const limit = parseLimit(options.limit);
  const database = openProjectDatabase(cwd, options.database);
  try {
    const rows = listRecords(database, {
      entity: options.entity,
      source: options.source,
      limit,
      includeDeleted: options.includeDeleted ?? false,
    });
    if (options.json) {
      return JSON.stringify(rows);
    }
    return formatRecordsTable(rows);
  } finally {
    database.close();
  }
}

export function runRecordsShow(cwd: string, id: string, databaseName?: string): string {
  const database = openProjectDatabase(cwd, databaseName);
  try {
    const row = database
      .prepare(`
        select
          id,
          project_id,
          entity,
          local_id,
          source,
          captured_at,
          payload_json,
          metadata_json,
          created_at,
          updated_at,
          deleted_at
        from records
        where id = ?
      `)
      .get(id) as RecordDetailsRow | undefined;

    if (!row) {
      throw new Error(`unknown record "${id}"`);
    }

    return JSON.stringify(
      {
        id: row.id,
        project_id: row.project_id,
        entity: row.entity,
        local_id: row.local_id,
        source: row.source,
        captured_at: row.captured_at,
        payload: parseStoredJson(row.payload_json, "payload_json"),
        metadata: row.metadata_json === null ? null : parseStoredJson(row.metadata_json, "metadata_json"),
        created_at: row.created_at,
        updated_at: row.updated_at,
        deleted_at: row.deleted_at,
      },
      null,
      2,
    );
  } finally {
    database.close();
  }
}

function openProjectDatabase(cwd: string, databaseName?: string): Database.Database {
  const projectRoot = findProjectRoot(cwd);
  if (!projectRoot) {
    throw new Error("missing .agent-pipe project; run `agent-pipe init` first");
  }

  const projectConfigPath = path.join(projectRoot, ".agent-pipe", "project.yaml");
  const databasePath = resolveProjectDatabase(projectConfigPath, databaseName).absolutePath;

  const database = new Database(databasePath, { readonly: true });
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

function listRecords(
  database: Database.Database,
  options: {
    entity?: string;
    source?: string;
    limit: number;
    includeDeleted: boolean;
  },
): RecordSummary[] {
  const where: string[] = [];
  const params: Array<string | number> = [];

  if (options.entity) {
    where.push("entity = ?");
    params.push(options.entity);
  }
  if (options.source) {
    where.push("source = ?");
    params.push(options.source);
  }
  if (!options.includeDeleted) {
    where.push("deleted_at is null");
  }

  const whereClause = where.length > 0 ? `where ${where.join(" and ")}` : "";
  return database
    .prepare(
      `
        select id, entity, source, updated_at
        from records
        ${whereClause}
        order by updated_at desc
        limit ?
      `,
    )
    .all(...params, options.limit) as RecordSummary[];
}

function formatRecordsTable(rows: RecordSummary[]): string {
  const headers = ["ID", "ENTITY", "SOURCE", "UPDATED_AT"] as const;
  const tableRows = rows.map((row) => [row.id, row.entity, row.source ?? "", row.updated_at]);
  const widths = headers.map((header, index) => Math.max(header.length, ...tableRows.map((row) => row[index].length)));
  const formatRow = (row: readonly string[]) => row.map((value, index) => value.padEnd(widths[index])).join("  ").trimEnd();
  return `${formatRow(headers)}${tableRows.length > 0 ? `\n${tableRows.map((row) => formatRow(row)).join("\n")}` : ""}`;
}

function parseStoredJson(value: string, fieldName: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`invalid stored ${fieldName}`);
  }
}
