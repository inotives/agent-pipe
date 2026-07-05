import fs from "node:fs";

import Database from "better-sqlite3";
import { parse } from "yaml";

import { validateProjectId } from "./project.js";

export function loadProjectId(projectConfigPath: string): string {
  try {
    const parsed = parse(fs.readFileSync(projectConfigPath, "utf8")) as { projectId?: unknown };
    if (!parsed || typeof parsed !== "object" || typeof parsed.projectId !== "string") {
      throw new Error("invalid");
    }
    return validateProjectId(parsed.projectId);
  } catch {
    throw new Error("invalid .agent-pipe/project.yaml");
  }
}

export function loadEnvLocal(envLocalPath: string): Record<string, string> {
  if (!fs.existsSync(envLocalPath)) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const rawLine of fs.readFileSync(envLocalPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) {
      continue;
    }
    result[match[1]] = match[2];
  }
  return result;
}

export function insertJobRun(
  database: Database.Database,
  input: {
    id: string;
    jobId: string;
    entity: string;
    status: string;
    startedAt: string;
    metadataJson: string | null;
  },
): void {
  database
    .prepare(`
      insert into job_runs (
        id, job_id, entity, status, started_at, finished_at, records_written, error_message, metadata_json
      ) values (
        @id, @job_id, @entity, @status, @started_at, null, 0, null, @metadata_json
      )
    `)
    .run({
      id: input.id,
      job_id: input.jobId,
      entity: input.entity,
      status: input.status,
      started_at: input.startedAt,
      metadata_json: input.metadataJson,
    });
}

export function updateJobRunRecordsWritten(database: Database.Database, id: string, recordsWritten: number): void {
  database.prepare("update job_runs set records_written = ? where id = ?").run(recordsWritten, id);
}

export function updateJobRun(
  database: Database.Database,
  input: {
    id: string;
    status: string;
    finishedAt: string;
    recordsWritten: number;
    errorMessage: string | null;
    metadataJson?: string | null;
  },
): void {
  database
    .prepare(`
      update job_runs
      set status = @status,
          finished_at = @finished_at,
          records_written = @records_written,
          error_message = @error_message,
          metadata_json = coalesce(@metadata_json, metadata_json)
      where id = @id
    `)
    .run({
      id: input.id,
      status: input.status,
      finished_at: input.finishedAt,
      records_written: input.recordsWritten,
      error_message: input.errorMessage,
      metadata_json: input.metadataJson,
    });
}

export function readJobRunRecordsWritten(database: Database.Database, id: string): number {
  const row = database.prepare("select records_written from job_runs where id = ?").get(id) as
    | { records_written: number }
    | undefined;
  return row?.records_written ?? 0;
}
