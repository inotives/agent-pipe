import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import Database from "better-sqlite3";
import { parse as parseCsv } from "csv-parse/sync";
import { parse } from "yaml";
import { z } from "zod";

import { findProjectRoot } from "./project.js";
import { buildRecordRows, upsertRecords } from "./records.js";
import {
  bootstrapProjectDatabase,
  ensureSupportedSchemaVersion,
  insertJobRun,
  loadEnvLocal,
  loadProjectId,
  readJobRunRecordsWritten,
  resolveProjectDatabase,
  updateJobRun,
  updateJobRunRecordsWritten,
} from "./runtime.js";

const scalarValueSchema = z.union([z.string(), z.number(), z.boolean()]);
const sourceConfigBaseSchema = z.object({
  database: z.string().min(1).optional(),
  entity: z.string().min(1),
  idFields: z.array(z.string().min(1)).min(1),
});
const apiSourceConfigSchema = sourceConfigBaseSchema.extend({
  type: z.literal("api"),
  api: z.object({
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
  }),
});
const fileSourceConfigSchema = sourceConfigBaseSchema.extend({
  type: z.literal("file"),
  file: z.object({
    path: z.string().min(1),
    format: z.enum(["json", "csv", "markdown"]),
  }),
});
const sourceConfigSchema = z.discriminatedUnion("type", [
  apiSourceConfigSchema,
  fileSourceConfigSchema,
]);

type SourceConfig = z.infer<typeof sourceConfigSchema>;

const sourceConfigSchemaByType = {
  api: apiSourceConfigSchema,
  file: fileSourceConfigSchema,
} as const;

function isKnownSourceType(value: unknown): value is keyof typeof sourceConfigSchemaByType {
  return value === "api" || value === "file";
}

function formatSourceConfigError(sourceId: string, error: z.ZodError): string {
  const issue = error.issues[0];
  const pathValue = issue?.path.join(".");
  if (!pathValue) {
    return `invalid source "${sourceId}"`;
  }
  if (pathValue === "file") {
    return `invalid source "${sourceId}": missing file config`;
  }
  if (pathValue === "file.path") {
    return `invalid source "${sourceId}": missing file.path`;
  }
  if (pathValue === "file.format") {
    return `invalid source "${sourceId}": unsupported file.format`;
  }
  if (pathValue === "api") {
    return `invalid source "${sourceId}": missing api config`;
  }
  if (pathValue === "idFields") {
    return `invalid source "${sourceId}": missing idFields`;
  }
  return `invalid source "${sourceId}"`;
}

function parseSelectedSource(sourceId: string, source: unknown): SourceConfig {
  const config = source && typeof source === "object" ? (source as Record<string, unknown>) : {};
  if (!isKnownSourceType(config.type)) {
    return sourceConfigSchema.parse(config);
  }
  return sourceConfigSchemaByType[config.type].parse(config);
}

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
  if (!fs.existsSync(projectConfigPath)) {
    throw new Error("missing .agent-pipe/project.yaml; run `agent-pipe init` first");
  }
  if (!fs.existsSync(sourcesPath)) {
    throw new Error("missing .agent-pipe/sources.yaml; run `agent-pipe init` first");
  }

  const projectId = loadProjectId(projectConfigPath);
  const sourceConfig = loadSelectedSource(sourcesPath, options.sourceId);
  let selectedDatabase;
  try {
    selectedDatabase = resolveProjectDatabase(projectConfigPath, sourceConfig.database);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("unknown database ")) {
      throw new Error(`${error.message} for source "${options.sourceId}"`);
    }
    throw error;
  }
  bootstrapProjectDatabase(selectedDatabase.absolutePath);
  const database = new Database(selectedDatabase.absolutePath);
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
        if (sourceConfig.type === "api") {
          const envValues = {
            ...loadEnvLocal(envLocalPath),
            ...process.env,
          };
          const resolvedParams = resolveValues(sourceConfig.api.params ?? {}, envValues, options.sourceId);
          const resolvedQuery = resolveValues(sourceConfig.api.query ?? {}, envValues, options.sourceId);

          await fetchSourcePayloads({
            sourceId: options.sourceId,
            api: sourceConfig.api,
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
        } else if (
          sourceConfig.file.format === "json" ||
          sourceConfig.file.format === "csv" ||
          sourceConfig.file.format === "markdown"
        ) {
          const fileInput = loadFileSource({
            projectRoot,
            sourceId: options.sourceId,
            filePath: sourceConfig.file.path,
            format: sourceConfig.file.format,
            idFields: sourceConfig.idFields,
          });
          const rows = buildRecordRows({
            entity: sourceConfig.entity,
            idFields: sourceConfig.idFields,
            payloads: fileInput.payloadsWithMetadata.map((item) => item.payload),
            projectId,
            source: options.sourceId,
            metadataForPayload: (_, index) => fileInput.payloadsWithMetadata[index]?.metadata ?? null,
          });
          upsertRecords(database, rows.values());
          recordsWritten = fileInput.payloadsWithMetadata.length;
          updateJobRunRecordsWritten(database, jobRunId, recordsWritten);
        } else {
          throw new Error(`unsupported file format "${sourceConfig.file.format}" for source "${options.sourceId}"`);
        }
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

function loadFileSource(input: {
  projectRoot: string;
  sourceId: string;
  filePath: string;
  format: "json" | "csv" | "markdown";
  idFields: string[];
}): {
  payloadsWithMetadata: Array<{ payload: Record<string, unknown>; metadata: Record<string, unknown> }>;
} {
  const resolvedPath = resolveProjectFilePath(input.projectRoot, input.filePath, input.sourceId);
  if (input.format === "csv") {
    const payloads = parseCsvFileSource(resolvedPath.absolutePath, input.sourceId, input.idFields);
    return {
      payloadsWithMetadata: payloads.map((payload, index) => ({
        payload,
        metadata: {
          ingestionType: "file",
          path: resolvedPath.relativePath,
          format: "csv",
          rowNumber: index + 2,
        },
      })),
    };
  }
  if (input.format === "markdown") {
    const payload = parseMarkdownFileSource(resolvedPath.absolutePath, resolvedPath.relativePath);
    return {
      payloadsWithMetadata: [
        {
          payload,
          metadata: {
            ingestionType: "file",
            path: resolvedPath.relativePath,
            format: "markdown",
          },
        },
      ],
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(resolvedPath.absolutePath, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`invalid JSON file for source "${input.sourceId}"`);
    }
    throw error;
  }
  const payloads = normalizeJsonPayloads(parsed, input.sourceId);
  return {
    payloadsWithMetadata: payloads.map((payload, index) => ({
      payload,
      metadata: {
        ingestionType: "file",
        path: resolvedPath.relativePath,
        format: input.format,
        ...(payloads.length > 1 ? { itemIndex: index } : {}),
      },
    })),
  };
}

function parseCsvFileSource(filePath: string, sourceId: string, idFields: string[]): Array<Record<string, string>> {
  let rows: Array<Record<string, string>>;
  try {
    rows = parseCsv(fs.readFileSync(filePath, "utf8"), {
      columns: true,
      skip_empty_lines: true,
      relax_column_count: false,
    }) as Array<Record<string, string>>;
  } catch {
    throw new Error(`invalid CSV file for source "${sourceId}"`);
  }
  if (!rows.length) {
    throw new Error(`missing CSV header row for source "${sourceId}"`);
  }
  const headers = Object.keys(rows[0] ?? {});
  if (
    headers.length === 0 ||
    headers.some((header) => !header.trim()) ||
    idFields.some((field) => !headers.includes(field))
  ) {
    throw new Error(`missing CSV header row for source "${sourceId}"`);
  }
  return rows;
}

function parseMarkdownFileSource(filePath: string, relativePath: string): Record<string, string> {
  const content = fs.readFileSync(filePath, "utf8");
  return {
    path: relativePath,
    title: readMarkdownTitle(content, relativePath),
    content,
  };
}

function readMarkdownTitle(content: string, relativePath: string): string {
  const titleMatch = content.match(/^#\s+(.+?)\s*$/m);
  if (titleMatch?.[1]) {
    return titleMatch[1].trim();
  }
  return path.basename(relativePath, path.extname(relativePath));
}

function resolveProjectFilePath(
  projectRoot: string,
  filePath: string,
  sourceId: string,
): { absolutePath: string; relativePath: string } {
  if (path.isAbsolute(filePath)) {
    throw new Error(`absolute file.path is not allowed for source "${sourceId}"`);
  }
  const absolutePath = path.resolve(projectRoot, filePath);
  const relativePath = path.relative(projectRoot, absolutePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`file.path must stay within the project root for source "${sourceId}"`);
  }
  return {
    absolutePath,
    relativePath: relativePath.split(path.sep).join("/"),
  };
}

function loadSelectedSource(sourcesPath: string, sourceId: string): SourceConfig {
  try {
    const parsed = parse(fs.readFileSync(sourcesPath, "utf8")) as { sources?: Record<string, unknown> };
    const source = parsed?.sources?.[sourceId];
    if (!source) {
      const configured = Object.keys(parsed?.sources ?? {}).sort();
      throw new Error(
        `unknown source "${sourceId}"; configured sources: ${configured.join(", ") || "(none)"}`,
      );
    }
    return parseSelectedSource(sourceId, source);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(formatSourceConfigError(sourceId, error));
    }
    if (error instanceof Error && error.message.startsWith("unknown source ")) {
      throw error;
    }
    throw new Error("invalid .agent-pipe/sources.yaml");
  }
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
  api: z.infer<typeof apiSourceConfigSchema>["api"];
  params: Record<string, string | number | boolean>;
  query: Record<string, string | number | boolean>;
  onPage: (input: {
    payloadsWithMetadata: Array<{ payload: Record<string, unknown>; metadata: Record<string, unknown> }>;
  }) => void;
}): Promise<void> {
  if (input.api.method !== "GET") {
    throw new Error(`unsupported method "${input.api.method}" for source "${input.sourceId}"`);
  }
  if (input.api.payloadPath !== "$") {
    throw new Error(`unsupported payloadPath "${input.api.payloadPath}" for source "${input.sourceId}"`);
  }
  if (input.api.rateLimit?.requestsPerMinute !== undefined) {
    throw new Error(`unsupported requestsPerMinute for source "${input.sourceId}"`);
  }
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

    const payloads = normalizeJsonPayloads(parsed, input.sourceId);
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

function normalizeJsonPayloads(parsed: unknown, sourceId: string): Array<Record<string, unknown>> {
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
