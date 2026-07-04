import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { z } from "zod";

import { ensureSupportedSchemaVersion } from "./init.js";
import { findProjectRoot, validateProjectId } from "./project.js";

const inputRecordSchema = z.record(z.string(), z.unknown());
const inputPayloadSchema = z.union([inputRecordSchema, z.array(inputRecordSchema)]);

const projectConfigSchema = z.object({
  projectId: z.string().min(1),
});

const entityConfigSchema = z.object({
  idFields: z.array(z.string().min(1)).min(1),
});

type PutOptions = {
  entity: string;
  file: string;
};

type PutResult = {
  projectId: string;
  entity: string;
  recordsWritten: number;
};

type RecordRow = {
  id: string;
  project_id: string;
  entity: string;
  local_id: string;
  source: string;
  captured_at: string;
  payload_json: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
  deleted_at: null;
};

export function runPut(cwd: string, options: PutOptions): PutResult {
  const projectRoot = findProjectRoot(cwd);
  if (!projectRoot) {
    throw new Error("missing .agent-pipe project; run `agent-pipe init` first");
  }

  const stateDir = path.join(projectRoot, ".agent-pipe");
  const projectConfigPath = path.join(stateDir, "project.yaml");
  const schedulesPath = path.join(stateDir, "schedules.yaml");
  const databasePath = path.join(stateDir, "data", "local.sqlite");
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
  if (!fs.existsSync(databasePath)) {
    throw new Error("missing .agent-pipe/data/local.sqlite; run `agent-pipe init` first");
  }
  if (!fs.existsSync(inputPath)) {
    throw new Error(`input file not found: ${options.file}`);
  }

  const projectId = loadProjectId(projectConfigPath);
  const schedules = loadSchedules(schedulesPath);
  const entityConfig = schedules[options.entity];
  if (!entityConfig) {
    const configured = Object.keys(schedules).sort();
    throw new Error(
      `unknown entity "${options.entity}"; configured entities: ${configured.join(", ") || "(none)"}`,
    );
  }

  const payloads = loadInputPayloads(inputPath);
  const rows = buildRows({
    entity: options.entity,
    idFields: entityConfig.idFields,
    inputFile: options.file,
    payloads,
    projectId,
  });

  const database = new Database(databasePath);
  try {
    ensureSupportedSchemaVersion(database);

    const upsert = database.prepare(`
      insert into records (
        id, project_id, entity, local_id, source, captured_at, payload_json,
        metadata_json, created_at, updated_at, deleted_at
      ) values (
        @id, @project_id, @entity, @local_id, @source, @captured_at, @payload_json,
        @metadata_json, @created_at, @updated_at, @deleted_at
      )
      on conflict(id) do update set
        project_id = excluded.project_id,
        entity = excluded.entity,
        local_id = excluded.local_id,
        source = excluded.source,
        captured_at = excluded.captured_at,
        payload_json = excluded.payload_json,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at,
        deleted_at = excluded.deleted_at
    `);

    const writeAll = database.transaction((items: RecordRow[]) => {
      for (const row of items) {
        upsert.run(row);
      }
    });

    writeAll([...rows.values()]);
  } finally {
    database.close();
  }

  return {
    projectId,
    entity: options.entity,
    recordsWritten: payloads.length,
  };
}

function loadProjectId(projectConfigPath: string): string {
  const projectConfig = parseSimpleYamlObject(fs.readFileSync(projectConfigPath, "utf8"));
  const parsed = projectConfigSchema.safeParse(projectConfig);
  if (!parsed.success) {
    throw new Error("invalid .agent-pipe/project.yaml");
  }
  return validateProjectId(parsed.data.projectId);
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

function parseSimpleYamlObject(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.+)$/);
    if (!match) {
      continue;
    }
    const [, key, rawValue] = match;
    result[key] = parseYamlScalar(rawValue);
  }
  return result;
}

function parseYamlScalar(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
    return JSON.parse(trimmed) as string;
  }
  return trimmed;
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

function buildRows(input: {
  entity: string;
  idFields: string[];
  inputFile: string;
  payloads: Array<Record<string, unknown>>;
  projectId: string;
}): Map<string, RecordRow> {
  const rows = new Map<string, RecordRow>();

  for (const payload of input.payloads) {
    const localIdValues = input.idFields.map((field) => {
      if (!(field in payload)) {
        throw new Error(`missing id field "${field}" for entity "${input.entity}"`);
      }

      const value = payload[field];
      if (value === null) {
        throw new Error(`id field "${field}" for entity "${input.entity}" cannot be null`);
      }
      if (value === "") {
        throw new Error(`id field "${field}" for entity "${input.entity}" cannot be empty`);
      }
      if (Array.isArray(value) || (typeof value === "object" && value !== null)) {
        throw new Error(`id field "${field}" for entity "${input.entity}" must be a scalar value`);
      }
      return value;
    });

    const localId = JSON.stringify(localIdValues);
    const now = new Date().toISOString();
    const id = `${input.projectId}:${input.entity}:${localId}`;
    rows.set(id, {
      id,
      project_id: input.projectId,
      entity: input.entity,
      local_id: localId,
      source: "file",
      captured_at: now,
      payload_json: JSON.stringify(payload),
      metadata_json: JSON.stringify({ inputFile: input.inputFile }),
      created_at: now,
      updated_at: now,
      deleted_at: null,
    });
  }

  return rows;
}
