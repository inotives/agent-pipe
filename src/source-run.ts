import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import Database from "better-sqlite3";
import { parse } from "yaml";
import { z } from "zod";

import { ensureSupportedSchemaVersion } from "./init.js";
import { findProjectRoot, validateProjectId } from "./project.js";
import { buildRecordRows, upsertRecords } from "./records.js";

const scalarValueSchema = z.union([z.string(), z.number(), z.boolean()]);
const sourceConfigSchema = z.object({
  entity: z.string().min(1),
  type: z.string().min(1),
  idFields: z.array(z.string().min(1)).min(1),
  api: z
    .object({
      baseUrl: z.string().min(1),
      endpoint: z.string().min(1),
      method: z.string().min(1),
      params: z.record(z.string(), scalarValueSchema).optional(),
      query: z.record(z.string(), scalarValueSchema).optional(),
      payloadPath: z.string().min(1),
      pagination: z.record(z.string(), z.unknown()),
      rateLimit: z
        .object({
          minDelayMs: z.number().nonnegative().optional(),
          requestsPerMinute: z.number().positive().optional(),
        })
        .optional(),
    })
    .optional(),
});

type SourceRunOptions = {
  sourceId: string;
};

type SourceRunResult = {
  sourceId: string;
  entity: string;
  recordsWritten: number;
  jobRunId: string;
};

async function runSourceWithFailureTracking(input: {
  database: Database.Database;
  jobRunId: string;
  execute: () => Promise<SourceRunResult>;
}): Promise<SourceRunResult> {
  try {
    return await input.execute();
  } catch (error) {
    updateJobRun(input.database, {
      id: input.jobRunId,
      status: "failed",
      finishedAt: new Date().toISOString(),
      recordsWritten: readJobRunRecordsWritten(input.database, input.jobRunId),
      errorMessage: error instanceof Error ? error.message : "source run failed",
    });
    throw error;
  }
}

export async function runSource(cwd: string, options: SourceRunOptions): Promise<SourceRunResult> {
  const projectRoot = findProjectRoot(cwd);
  if (!projectRoot) {
    throw new Error("missing .agent-pipe project; run `agent-pipe init` first");
  }

  const stateDir = path.join(projectRoot, ".agent-pipe");
  const projectConfigPath = path.join(stateDir, "project.yaml");
  const sourcesPath = path.join(stateDir, "sources.yaml");
  const envLocalPath = path.join(stateDir, ".env.local");
  const databasePath = path.join(stateDir, "data", "local.sqlite");
  if (!fs.existsSync(projectConfigPath)) {
    throw new Error("missing .agent-pipe/project.yaml; run `agent-pipe init` first");
  }
  if (!fs.existsSync(sourcesPath)) {
    throw new Error("missing .agent-pipe/sources.yaml; run `agent-pipe init` first");
  }
  if (!fs.existsSync(databasePath)) {
    throw new Error("missing .agent-pipe/data/local.sqlite; run `agent-pipe init` first");
  }

  const projectId = loadProjectId(projectConfigPath);
  const sourceConfig = loadSelectedSource(sourcesPath, options.sourceId);
  if (sourceConfig.type !== "api") {
    throw new Error(`unsupported source type "${sourceConfig.type}" for source "${options.sourceId}"`);
  }
  if (!sourceConfig.api) {
    throw new Error(`invalid source "${options.sourceId}": missing api config`);
  }
  if (sourceConfig.api.method !== "GET") {
    throw new Error(`unsupported method "${sourceConfig.api.method}" for source "${options.sourceId}"`);
  }
  if (sourceConfig.api.payloadPath !== "$") {
    throw new Error(`unsupported payloadPath "${sourceConfig.api.payloadPath}" for source "${options.sourceId}"`);
  }
  if (sourceConfig.api.rateLimit?.requestsPerMinute !== undefined) {
    throw new Error(`unsupported requestsPerMinute for source "${options.sourceId}"`);
  }
  const apiConfig = sourceConfig.api;

  const envValues = {
    ...loadEnvLocal(envLocalPath),
    ...process.env,
  };
  const resolvedParams = resolveValues(apiConfig.params ?? {}, envValues, options.sourceId);
  const resolvedQuery = resolveValues(apiConfig.query ?? {}, envValues, options.sourceId);

  const database = new Database(databasePath);
  const jobRunId = randomUUID();
  const startedAt = new Date().toISOString();
  let recordsWritten = 0;
  try {
    ensureSupportedSchemaVersion(database);
    insertJobRun(database, {
      id: jobRunId,
      jobId: options.sourceId,
      entity: sourceConfig.entity,
      status: "running",
      startedAt,
      metadataJson: JSON.stringify({ sourceId: options.sourceId }),
    });

    return await runSourceWithFailureTracking({
      database,
      jobRunId,
      execute: async () => {
        await fetchSourcePayloads({
          sourceId: options.sourceId,
          api: apiConfig,
          params: resolvedParams,
          query: resolvedQuery,
          onPage: ({ payloadsWithMetadata }) => {
            const rows = buildRecordRows({
              entity: sourceConfig.entity,
              idFields: sourceConfig.idFields,
              payloads: payloadsWithMetadata.map((item) => item.payload),
              projectId,
              source: options.sourceId,
              idFallbacks: { ...resolvedParams, ...resolvedQuery },
              metadataForPayload: (_, index) => payloadsWithMetadata[index]?.metadata ?? null,
            });
            upsertRecords(database, rows.values());
            recordsWritten += payloadsWithMetadata.length;
            updateJobRunRecordsWritten(database, jobRunId, recordsWritten);
          },
        });
        updateJobRun(database, {
          id: jobRunId,
          status: "succeeded",
          finishedAt: new Date().toISOString(),
          recordsWritten,
          errorMessage: null,
        });

        return {
          sourceId: options.sourceId,
          entity: sourceConfig.entity,
          recordsWritten,
          jobRunId,
        };
      },
    });
  } finally {
    database.close();
  }
}

function loadProjectId(projectConfigPath: string): string {
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

function loadSelectedSource(sourcesPath: string, sourceId: string): z.infer<typeof sourceConfigSchema> {
  try {
    const parsed = parse(fs.readFileSync(sourcesPath, "utf8")) as { sources?: Record<string, unknown> };
    const source = parsed?.sources?.[sourceId];
    if (!source) {
      const configured = Object.keys(parsed?.sources ?? {}).sort();
      throw new Error(
        `unknown source "${sourceId}"; configured sources: ${configured.join(", ") || "(none)"}`,
      );
    }
    return sourceConfigSchema.parse(source);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(`invalid source "${sourceId}"`);
    }
    if (error instanceof Error && error.message.startsWith("unknown source ")) {
      throw error;
    }
    throw new Error("invalid .agent-pipe/sources.yaml");
  }
}

function loadEnvLocal(envLocalPath: string): Record<string, string> {
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

function resolveValues(
  values: Record<string, string | number | boolean>,
  envValues: Record<string, string | undefined>,
  sourceId: string,
): Record<string, string | number | boolean> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, resolveScalarValue(value, envValues, sourceId)]),
  );
}

function resolveScalarValue(
  value: string | number | boolean,
  envValues: Record<string, string | undefined>,
  sourceId: string,
): string | number | boolean {
  if (typeof value !== "string") {
    return value;
  }
  return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_, name: string) => {
    const resolved = envValues[name];
    if (resolved === undefined) {
      throw new Error(`missing env placeholder "${name}" for source "${sourceId}"`);
    }
    return resolved;
  });
}

async function fetchSourcePayloads(input: {
  sourceId: string;
  api: NonNullable<z.infer<typeof sourceConfigSchema>["api"]>;
  params: Record<string, string | number | boolean>;
  query: Record<string, string | number | boolean>;
  onPage: (input: {
    payloadsWithMetadata: Array<{ payload: Record<string, unknown>; metadata: Record<string, unknown> }>;
  }) => void;
}): Promise<void> {
  const pagination = readPagination(input.api.pagination, input.query, input.sourceId);
  let page = pagination.type === "page" ? pagination.startPage : 1;
  let requestCount = 0;

  while (true) {
    if (requestCount > 0 && input.api.rateLimit?.minDelayMs) {
      await delay(input.api.rateLimit.minDelayMs);
    }

    const requestUrl = buildRequestUrl({
      baseUrl: input.api.baseUrl,
      endpoint: input.api.endpoint,
      params: input.params,
      query:
        pagination.type === "page"
          ? {
              ...input.query,
              [pagination.pageParam]: page,
              [pagination.perPageParam]: pagination.perPageValue,
            }
          : input.query,
    });
    requestCount += 1;

    const response = await fetch(requestUrl);
    if (!response.ok) {
      throw new Error(`request failed with status ${response.status} for ${requestUrl}`);
    }

    const fetchedAt = new Date().toISOString();
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      throw new Error(`invalid JSON response for ${requestUrl}`);
    }

    const payloads = normalizePayloads(parsed, input.sourceId);
    const payloadsWithMetadata = payloads.map((payload) => ({
        payload,
        metadata: {
          url: requestUrl,
          statusCode: response.status,
          fetchedAt,
          ingestionType: "api",
        },
      }));
    input.onPage({ payloadsWithMetadata });

    if (pagination.type === "none") {
      return;
    }
    if (payloads.length === 0 && pagination.stopWhen === "empty_page") {
      return;
    }
    if (page >= pagination.maxPages) {
      return;
    }
    page += 1;
  }
}

function insertJobRun(database: Database.Database, input: {
  id: string;
  jobId: string;
  entity: string;
  status: string;
  startedAt: string;
  metadataJson: string | null;
}): void {
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

function updateJobRunRecordsWritten(database: Database.Database, id: string, recordsWritten: number): void {
  database.prepare("update job_runs set records_written = ? where id = ?").run(recordsWritten, id);
}

function updateJobRun(database: Database.Database, input: {
  id: string;
  status: string;
  finishedAt: string;
  recordsWritten: number;
  errorMessage: string | null;
}): void {
  database
    .prepare(`
      update job_runs
      set status = @status,
          finished_at = @finished_at,
          records_written = @records_written,
          error_message = @error_message
      where id = @id
    `)
    .run({
      id: input.id,
      status: input.status,
      finished_at: input.finishedAt,
      records_written: input.recordsWritten,
      error_message: input.errorMessage,
    });
}

function readJobRunRecordsWritten(database: Database.Database, id: string): number {
  const row = database.prepare("select records_written from job_runs where id = ?").get(id) as
    | { records_written: number }
    | undefined;
  return row?.records_written ?? 0;
}

function readPagination(
  pagination: Record<string, unknown>,
  query: Record<string, string | number | boolean>,
  sourceId: string,
):
  | { type: "none" }
  | {
      type: "page";
      pageParam: string;
      perPageParam: string;
      perPageValue: string | number | boolean;
      startPage: number;
      maxPages: number;
      stopWhen: "empty_page";
    } {
  const type = typeof pagination.type === "string" ? pagination.type : "";
  if (type === "none") {
    return { type: "none" };
  }
  if (type !== "page") {
    throw new Error(`unsupported pagination type "${type}" for source "${sourceId}"`);
  }
  const pageParam = typeof pagination.pageParam === "string" ? pagination.pageParam : "";
  const perPageParam = typeof pagination.perPageParam === "string" ? pagination.perPageParam : "";
  const stopWhen = pagination.stopWhen;
  const startPage = typeof pagination.startPage === "number" ? pagination.startPage : 1;
  const maxPages = typeof pagination.maxPages === "number" ? pagination.maxPages : null;
  const perPageValue = perPageParam ? query[perPageParam] : undefined;
  if (!pageParam || !perPageParam || !maxPages || perPageValue === undefined) {
    throw new Error(`invalid page pagination for source "${sourceId}"`);
  }
  if (stopWhen !== "empty_page") {
    throw new Error(`unsupported stopWhen "${String(stopWhen)}" for source "${sourceId}"`);
  }
  return { type: "page", pageParam, perPageParam, perPageValue, startPage, maxPages, stopWhen };
}

function buildRequestUrl(input: {
  baseUrl: string;
  endpoint: string;
  params: Record<string, string | number | boolean>;
  query: Record<string, string | number | boolean>;
}): string {
  const endpoint = input.endpoint.replace(/\{([A-Za-z0-9_]+)\}/g, (_, name: string) => {
    if (!(name in input.params)) {
      throw new Error(`missing path param "${name}"`);
    }
    return encodeURIComponent(String(input.params[name]));
  });
  const url = new URL(endpoint.replace(/^\/+/, ""), ensureTrailingSlash(input.baseUrl));
  for (const [key, value] of Object.entries(input.query)) {
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function normalizePayloads(parsed: unknown, sourceId: string): Array<Record<string, unknown>> {
  if (Array.isArray(parsed)) {
    if (!parsed.every(isRecord)) {
      throw new Error(`source "${sourceId}" returned a non-object item`);
    }
    return parsed;
  }
  if (isRecord(parsed)) {
    return [parsed];
  }
  throw new Error(`source "${sourceId}" must return a top-level object or array`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
