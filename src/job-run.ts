import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { exec } from "node:child_process";
import { promisify } from "node:util";

import Database from "better-sqlite3";

import { ensureSupportedSchemaVersion } from "./init.js";
import { findProjectRoot } from "./project.js";
import { buildRecordRows, upsertRecords } from "./records.js";
import {
  insertJobRun,
  loadEnvLocal,
  loadProjectId,
  readJobRunRecordsWritten,
  updateJobRun,
  updateJobRunRecordsWritten,
} from "./runtime.js";
import { loadSchedulesConfig } from "./schedules.js";

const execAsync = promisify(exec);

type JobRunOptions = {
  jobId: string;
};

type JobRunResult = {
  jobId: string;
  entity: string;
  recordsWritten: number;
  jobRunId: string;
};

export async function runJob(cwd: string, options: JobRunOptions): Promise<JobRunResult> {
  const projectRoot = findProjectRoot(cwd);
  if (!projectRoot) {
    throw new Error("missing .agent-pipe project; run `agent-pipe init` first");
  }

  const stateDir = path.join(projectRoot, ".agent-pipe");
  const projectConfigPath = path.join(stateDir, "project.yaml");
  const schedulesPath = path.join(stateDir, "schedules.yaml");
  const envLocalPath = path.join(stateDir, ".env.local");
  const databasePath = path.join(stateDir, "data", "local.sqlite");
  if (!fs.existsSync(projectConfigPath)) {
    throw new Error("missing .agent-pipe/project.yaml; run `agent-pipe init` first");
  }
  if (!fs.existsSync(schedulesPath)) {
    throw new Error("missing .agent-pipe/schedules.yaml; run `agent-pipe init` first");
  }
  if (!fs.existsSync(databasePath)) {
    throw new Error("missing .agent-pipe/data/local.sqlite; run `agent-pipe init` first");
  }

  const database = new Database(databasePath);
  const jobRunId = randomUUID();
  const startedAt = new Date().toISOString();
  let recordsWritten = 0;
  try {
    ensureSupportedSchemaVersion(database);
    const projectId = loadProjectId(projectConfigPath);
    let schedules;
    try {
      schedules = loadSchedulesConfig(schedulesPath);
    } catch (error) {
      insertFailedJobRun(database, {
        id: jobRunId,
        jobId: options.jobId,
        entity: "unknown",
        startedAt,
        command: null,
        timeoutMs: null,
        errorMessage: error instanceof Error ? error.message : "job run failed",
      });
      throw error;
    }
    const job = schedules.jobs[options.jobId];
    if (!job) {
      const configured = Object.keys(schedules.jobs).sort();
      const errorMessage = `unknown job "${options.jobId}"; configured jobs: ${configured.join(", ") || "(none)"}`;
      insertFailedJobRun(database, {
        id: jobRunId,
        jobId: options.jobId,
        entity: "unknown",
        startedAt,
        command: null,
        timeoutMs: null,
        errorMessage,
      });
      throw new Error(errorMessage);
    }
    const timeoutMs = job.timeoutMs ?? 60000;
    const childEnv = {
      ...loadEnvLocal(envLocalPath),
      ...process.env,
    };
    if (hasRunningJob(database, options.jobId)) {
      insertJobRun(database, {
        id: jobRunId,
        jobId: options.jobId,
        entity: job.entity,
        status: "skipped",
        startedAt,
        metadataJson: JSON.stringify({ jobId: options.jobId, command: job.command, timeoutMs }),
      });
      updateJobRun(database, {
        id: jobRunId,
        status: "skipped",
        finishedAt: new Date().toISOString(),
        recordsWritten: 0,
        errorMessage: `job "${options.jobId}" is already running`,
      });
      throw new Error(`job "${options.jobId}" is already running`);
    }
    insertJobRun(database, {
      id: jobRunId,
      jobId: options.jobId,
      entity: job.entity,
      status: "running",
      startedAt,
      metadataJson: JSON.stringify({ jobId: options.jobId, command: job.command, timeoutMs }),
    });

    try {
      const startedMs = Date.now();
      const { stdout } = await execAsync(job.command, {
        cwd: projectRoot,
        env: childEnv,
        encoding: "utf8",
        timeout: timeoutMs,
      });
      const payloads = parseOutputPayloads(stdout, options.jobId);
      const rows = buildRecordRows({
        entity: job.entity,
        idFields: schedules.entities[job.entity].idFields,
        payloads,
        projectId,
        source: options.jobId,
        metadataForPayload: () => ({
          jobId: options.jobId,
          command: job.command,
          ingestionType: "job",
        }),
      });
      upsertRecords(database, rows.values());
      recordsWritten = payloads.length;
      updateJobRunRecordsWritten(database, jobRunId, recordsWritten);
      updateJobRun(database, {
        id: jobRunId,
        status: "succeeded",
        finishedAt: new Date().toISOString(),
        recordsWritten,
        errorMessage: null,
        metadataJson: JSON.stringify({
          jobId: options.jobId,
          command: job.command,
          exitCode: 0,
          durationMs: Date.now() - startedMs,
          timeoutMs,
        }),
      });

      return {
        jobId: options.jobId,
        entity: job.entity,
        recordsWritten,
        jobRunId,
      };
    } catch (error) {
      updateJobRun(database, {
        id: jobRunId,
        status: "failed",
        finishedAt: new Date().toISOString(),
        recordsWritten: readJobRunRecordsWritten(database, jobRunId),
        errorMessage: readErrorMessage(error, options.jobId),
        metadataJson: JSON.stringify({
          jobId: options.jobId,
          command: job.command,
          exitCode: readExitCode(error),
          durationMs: null,
          timeoutMs,
        }),
      });
      throw new Error(readErrorMessage(error, options.jobId));
    }
  } finally {
    database.close();
  }
}

function insertFailedJobRun(
  database: Database.Database,
  input: {
    id: string;
    jobId: string;
    entity: string;
    startedAt: string;
    command: string | null;
    timeoutMs: number | null;
    errorMessage: string;
  },
): void {
  insertJobRun(database, {
    id: input.id,
    jobId: input.jobId,
    entity: input.entity,
    status: "failed",
    startedAt: input.startedAt,
    metadataJson: JSON.stringify({
      jobId: input.jobId,
      command: input.command,
      exitCode: null,
      durationMs: null,
      timeoutMs: input.timeoutMs,
    }),
  });
  updateJobRun(database, {
    id: input.id,
    status: "failed",
    finishedAt: new Date().toISOString(),
    recordsWritten: 0,
    errorMessage: input.errorMessage,
  });
}

function hasRunningJob(database: Database.Database, jobId: string): boolean {
  const row = database
    .prepare("select 1 from job_runs where job_id = ? and status = 'running' limit 1")
    .get(jobId) as { 1: number } | undefined;
  return Boolean(row);
}

function parseOutputPayloads(stdout: string, jobId: string): Array<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`job "${jobId}" must print valid JSON`);
  }

  if (Array.isArray(parsed)) {
    if (!parsed.every(isRecord)) {
      throw new Error(`job "${jobId}" returned a non-object item`);
    }
    return parsed;
  }
  if (isRecord(parsed)) {
    return [parsed];
  }
  throw new Error(`job "${jobId}" must return a top-level object or array`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readErrorMessage(error: unknown, jobId: string): string {
  if (isExecError(error)) {
    if (error.killed && error.signal) {
      return `job "${jobId}" timed out after ${error.signal === "SIGTERM" ? "configured timeout" : error.signal}`;
    }
    const stderr = typeof error.stderr === "string" ? error.stderr.trim() : "";
    const stdout = typeof error.stdout === "string" ? error.stdout.trim() : "";
    const snippet = stderr || stdout || error.message || "job run failed";
    return snippet.slice(0, 1000);
  }
  if (error instanceof Error) {
    return error.message.slice(0, 1000);
  }
  return "job run failed";
}

function readExitCode(error: unknown): number | null {
  return isExecError(error) && typeof error.code === "number" ? error.code : null;
}

function isExecError(
  error: unknown,
): error is Error & { code?: unknown; killed?: boolean; signal?: string | null; stdout?: unknown; stderr?: unknown } {
  return error instanceof Error;
}
