import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { z } from "zod";

import { findProjectRoot } from "./project.js";
import { buildRecordRows, upsertRecords } from "./records.js";
import { bootstrapProjectDatabase, ensureSupportedSchemaVersion, loadProjectId, resolveProjectDatabase } from "./runtime.js";

const inputRecordSchema = z.record(z.string(), z.unknown());
const inputPayloadSchema = z.union([inputRecordSchema, z.array(inputRecordSchema)]);

const entityConfigSchema = z.object({
  idFields: z.array(z.string().min(1)).min(1),
});

type PutOptions = {
  entity: string;
  file: string;
  database?: string;
};

type PutResult = {
  projectId: string;
  entity: string;
  recordsWritten: number;
};

export function runPut(cwd: string, options: PutOptions): PutResult {
  const projectRoot = findProjectRoot(cwd);
  if (!projectRoot) {
    throw new Error("missing .agent-pipe project; run `agent-pipe init` first");
  }

  const stateDir = path.join(projectRoot, ".agent-pipe");
  const projectConfigPath = path.join(stateDir, "project.yaml");
  const schedulesPath = path.join(stateDir, "schedules.yaml");
  const inputPath = path.resolve(cwd, options.file);

  if (options.file === "-") {
    throw new Error("stdin is not supported for put in Phase 1; provide --file <path>");
  }
  if (!fs.existsSync(projectConfigPath)) {
    throw new Error("missing .agent-pipe/project.yaml; run `agent-pipe init` first");
  }
  if (!fs.existsSync(schedulesPath)) {
    throw new Error("missing .agent-pipe/schedules.yaml; run `agent-pipe init` first");
  }
  if (!fs.existsSync(inputPath)) {
    throw new Error(`input file not found: ${options.file}`);
  }

  const projectId = loadProjectId(projectConfigPath);
  let selectedDatabase;
  try {
    selectedDatabase = resolveProjectDatabase(projectConfigPath, options.database);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("unknown database ")) {
      throw error;
    }
    throw error;
  }
  const schedules = loadSchedules(schedulesPath);
  const entityConfig = schedules[options.entity];
  if (!entityConfig) {
    const configured = Object.keys(schedules).sort();
    throw new Error(
      `unknown entity "${options.entity}"; configured entities: ${configured.join(", ") || "(none)"}`,
    );
  }

  const payloads = loadInputPayloads(inputPath);
  const rows = buildRecordRows({
    entity: options.entity,
    idFields: entityConfig.idFields,
    payloads,
    projectId,
    source: "file",
    metadataForPayload: () => ({ inputFile: options.file }),
  });

  bootstrapProjectDatabase(selectedDatabase.absolutePath);
  const database = new Database(selectedDatabase.absolutePath);
  try {
    ensureSupportedSchemaVersion(database);
    upsertRecords(database, rows.values());
  } finally {
    database.close();
  }

  return {
    projectId,
    entity: options.entity,
    recordsWritten: payloads.length,
  };
}
function loadSchedules(schedulesPath: string): Record<string, z.infer<typeof entityConfigSchema>> {
  const lines = fs.readFileSync(schedulesPath, "utf8").split(/\r?\n/);
  const entities: Record<string, { idFields: string[] }> = {};
  let currentEntity: string | null = null;
  let collectingIdFields = false;

  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    if (/^\S/.test(line)) {
      currentEntity = null;
      collectingIdFields = false;
      continue;
    }
    const entityMatch = line.match(/^  ([a-z0-9_-]+):\s*$/);
    if (entityMatch) {
      currentEntity = entityMatch[1];
      entities[currentEntity] = { idFields: [] };
      collectingIdFields = false;
      continue;
    }
    if (currentEntity && /^\s{4}idFields:\s*$/.test(line)) {
      collectingIdFields = true;
      continue;
    }
    if (currentEntity && collectingIdFields) {
      const fieldMatch = line.match(/^\s{6}-\s+(.+?)\s*$/);
      if (fieldMatch) {
        entities[currentEntity].idFields.push(fieldMatch[1]);
        continue;
      }
      collectingIdFields = false;
    }
  }

  const parsed = z.record(z.string(), entityConfigSchema).safeParse(entities);
  if (!parsed.success) {
    throw new Error("invalid .agent-pipe/schedules.yaml");
  }
  return parsed.data;
}

function loadInputPayloads(inputPath: string): Array<Record<string, unknown>> {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  } catch {
    throw new Error(`invalid JSON input: ${inputPath}`);
  }

  const parsed = inputPayloadSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new Error("input JSON must be an object or an array of objects");
  }
  return Array.isArray(parsed.data) ? parsed.data : [parsed.data];
}
