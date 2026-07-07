import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { parse } from "yaml";
import { z } from "zod";

import { validateProjectId } from "./project.js";

const databaseConfigSchema = z.object({
  type: z.string(),
  path: z.string().min(1),
});

const projectConfigSchema = z.object({
  projectId: z.string(),
  projectName: z.string().optional(),
  defaultDatabase: z.string().optional(),
  databases: z.record(z.string(), databaseConfigSchema).optional(),
});

export type ProjectDatabaseConfig = {
  type: "sqlite";
  path: string;
  absolutePath: string;
};

export type ProjectConfig = {
  projectId: string;
  projectName?: string;
  defaultDatabase: string;
  databases: Record<string, ProjectDatabaseConfig>;
};

export type ResolvedProjectDatabase = ProjectDatabaseConfig & {
  name: string;
};

export type ProjectDatabaseHealth = {
  schema_migrations: boolean;
  records: boolean;
  job_runs: boolean;
};

export type ProjectDatabaseIndexHealth = {
  idx_records_entity: boolean;
  idx_records_source: boolean;
  idx_records_updated_at: boolean;
  idx_records_deleted_at: boolean;
  idx_job_runs_job_id: boolean;
  idx_job_runs_status: boolean;
  idx_job_runs_started_at: boolean;
};

export type ProjectDatabaseStatus = {
  database: string;
  configuredPath: string;
  absolutePath: string;
  exists: boolean;
  schemaStatus: "missing" | "ok" | "empty" | "incompatible_pre_release" | "unsupported" | "unreadable";
  schemaVersion: number | null;
  tables: ProjectDatabaseHealth;
  indexes: ProjectDatabaseIndexHealth;
};

const SUPPORTED_SCHEMA_VERSION = 1;
const BUILT_IN_INDEXES = [
  "create index if not exists idx_records_entity on records (entity)",
  "create index if not exists idx_records_source on records (source)",
  "create index if not exists idx_records_updated_at on records (updated_at)",
  "create index if not exists idx_records_deleted_at on records (deleted_at)",
  "create index if not exists idx_job_runs_job_id on job_runs (job_id)",
  "create index if not exists idx_job_runs_status on job_runs (status)",
  "create index if not exists idx_job_runs_started_at on job_runs (started_at)",
] as const;

export function loadProjectConfig(projectConfigPath: string): ProjectConfig {
  let parsedYaml: unknown;
  try {
    parsedYaml = parse(fs.readFileSync(projectConfigPath, "utf8"));
  } catch {
    throw new Error("invalid .agent-pipe/project.yaml");
  }

  const parsed = projectConfigSchema.safeParse(parsedYaml);
  if (!parsed.success) {
    throw new Error("invalid .agent-pipe/project.yaml");
  }

  const stateDir = path.dirname(projectConfigPath);
  const dataDir = path.resolve(stateDir, "data");
  const projectId = validateProjectId(parsed.data.projectId);
  const databases = parsed.data.databases ?? {
    local: {
      type: "sqlite",
      path: "data/local.sqlite",
    },
  };
  const defaultDatabase = parsed.data.defaultDatabase ?? "local";

  if (!Object.hasOwn(databases, defaultDatabase)) {
    throw new Error(`default database "${defaultDatabase}" is not configured`);
  }

  const normalizedDatabases = Object.fromEntries(
    Object.entries(databases).map(([name, database]) => {
      if (name.trim() === "") {
        throw new Error("database names must be non-empty");
      }
      if (database.type !== "sqlite") {
        throw new Error(`database "${name}" has unsupported type "${database.type}"; only sqlite is supported`);
      }
      if (path.isAbsolute(database.path)) {
        throw new Error(`database "${name}" path must stay under .agent-pipe/data/`);
      }

      const absolutePath = path.resolve(stateDir, database.path);
      const relativeToDataDir = path.relative(dataDir, absolutePath);
      if (relativeToDataDir === "" || relativeToDataDir.startsWith("..") || path.isAbsolute(relativeToDataDir)) {
        throw new Error(`database "${name}" path must stay under .agent-pipe/data/`);
      }

      return [
        name,
        {
          type: "sqlite" as const,
          path: database.path,
          absolutePath,
        },
      ];
    }),
  );

  return {
    projectId,
    projectName: parsed.data.projectName,
    defaultDatabase,
    databases: normalizedDatabases,
  };
}

export function resolveProjectDatabase(
  projectConfigPath: string,
  databaseName?: string,
): ResolvedProjectDatabase {
  const projectConfig = loadProjectConfig(projectConfigPath);
  const resolvedName = databaseName ?? projectConfig.defaultDatabase;
  const database = projectConfig.databases[resolvedName];
  if (!database) {
    throw new Error(`unknown database "${resolvedName}"`);
  }
  return {
    name: resolvedName,
    ...database,
  };
}

export function bootstrapProjectDatabase(databasePath: string): void {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = openDatabaseForBootstrap(databasePath);
  try {
    initializeManagedSchema(database);
    ensureSupportedSchemaVersion(database);
  } finally {
    database.close();
  }
}

export function ensureSupportedSchemaVersion(database: Database.Database): void {
  const versions = database
    .prepare("select version from schema_migrations order by version")
    .all() as Array<{ version: number }>;

  if (versions.length === 0) {
    database.prepare("insert into schema_migrations (version) values (?)").run(SUPPORTED_SCHEMA_VERSION);
    return;
  }

  if (versions.length !== 1 || versions[0]?.version !== SUPPORTED_SCHEMA_VERSION) {
    throw new Error(`unsupported schema version: found ${versions.map((row) => row.version).join(", ")}`);
  }
}

export function inspectProjectDatabaseStatus(database: ResolvedProjectDatabase): ProjectDatabaseStatus {
  const baseStatus: ProjectDatabaseStatus = {
    database: database.name,
    configuredPath: database.path,
    absolutePath: database.absolutePath,
    exists: fs.existsSync(database.absolutePath),
    schemaStatus: "missing",
    schemaVersion: null,
    tables: {
      schema_migrations: false,
      records: false,
      job_runs: false,
    },
    indexes: {
      idx_records_entity: false,
      idx_records_source: false,
      idx_records_updated_at: false,
      idx_records_deleted_at: false,
      idx_job_runs_job_id: false,
      idx_job_runs_status: false,
      idx_job_runs_started_at: false,
    },
  };

  if (!baseStatus.exists) {
    return baseStatus;
  }

  let sqlite: Database.Database | null = null;
  try {
    sqlite = new Database(database.absolutePath, { readonly: true, fileMustExist: true });
    const tables = sqlite
      .prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name")
      .all() as Array<{ name: string }>;
    const indexes = sqlite
      .prepare("select name from sqlite_master where type = 'index' and name not like 'sqlite_%' order by name")
      .all() as Array<{ name: string }>;
    const tableNames = new Set(tables.map((row) => row.name));
    const indexNames = new Set(indexes.map((row) => row.name));

    const tableHealth: ProjectDatabaseHealth = {
      schema_migrations: tableNames.has("schema_migrations"),
      records: tableNames.has("records"),
      job_runs: tableNames.has("job_runs"),
    };
    const indexHealth: ProjectDatabaseIndexHealth = {
      idx_records_entity: indexNames.has("idx_records_entity"),
      idx_records_source: indexNames.has("idx_records_source"),
      idx_records_updated_at: indexNames.has("idx_records_updated_at"),
      idx_records_deleted_at: indexNames.has("idx_records_deleted_at"),
      idx_job_runs_job_id: indexNames.has("idx_job_runs_job_id"),
      idx_job_runs_status: indexNames.has("idx_job_runs_status"),
      idx_job_runs_started_at: indexNames.has("idx_job_runs_started_at"),
    };

    let schemaStatus: ProjectDatabaseStatus["schemaStatus"] = "ok";
    let schemaVersion: number | null = null;

    if (!tableHealth.schema_migrations) {
      schemaStatus = tables.length === 0 ? "empty" : "incompatible_pre_release";
    } else if (!hasManagedSchemaShape(sqlite)) {
      schemaStatus = "incompatible_pre_release";
    } else {
      const versions = sqlite
        .prepare("select version from schema_migrations order by version")
        .all() as Array<{ version: number }>;
      if (versions.length === 1 && typeof versions[0]?.version === "number") {
        schemaVersion = versions[0].version;
      }
      try {
        ensureSupportedSchemaVersion(sqlite);
      } catch {
        schemaStatus = "unsupported";
      }
    }

    return {
      ...baseStatus,
      exists: true,
      schemaStatus,
      schemaVersion,
      tables: tableHealth,
      indexes: indexHealth,
    };
  } catch {
    return {
      ...baseStatus,
      exists: true,
      schemaStatus: "unreadable",
    };
  } finally {
    sqlite?.close();
  }
}

export function inspectAllConfiguredDatabases(projectConfigPath: string): ProjectDatabaseStatus[] {
  const projectConfig = loadProjectConfig(projectConfigPath);
  return Object.entries(projectConfig.databases)
    .map(([name]) => inspectProjectDatabaseStatus(resolveProjectDatabase(projectConfigPath, name)))
    .sort((left, right) => left.database.localeCompare(right.database));
}

export function bootstrapAllConfiguredDatabases(projectConfigPath: string): ProjectDatabaseStatus[] {
  const projectConfig = loadProjectConfig(projectConfigPath);
  for (const database of Object.values(projectConfig.databases)) {
    bootstrapProjectDatabase(database.absolutePath);
  }
  return inspectAllConfiguredDatabases(projectConfigPath);
}

function openDatabaseForBootstrap(databasePath: string): Database.Database {
  try {
    const database = new Database(databasePath);
    if (shouldReplacePreReleaseDatabase(database)) {
      database.close();
      fs.rmSync(databasePath, { force: true });
      return new Database(databasePath);
    }
    return database;
  } catch (error) {
    if (fs.existsSync(databasePath)) {
      fs.rmSync(databasePath, { force: true });
      return new Database(databasePath);
    }
    throw error;
  }
}

function shouldReplacePreReleaseDatabase(database: Database.Database): boolean {
  const rows = database
    .prepare(`
      select name
      from sqlite_master
      where type = 'table'
        and name not like 'sqlite_%'
      order by name
    `)
    .all() as Array<{ name: string }>;
  return rows.length > 0 && (!rows.some((row) => row.name === "schema_migrations") || !hasManagedSchemaShape(database));
}

function hasManagedSchemaShape(database: Database.Database): boolean {
  return (
    hasTableColumns(database, "records", [
      "id",
      "project_id",
      "entity",
      "local_id",
      "source",
      "captured_at",
      "payload_json",
      "metadata_json",
      "created_at",
      "updated_at",
      "deleted_at",
    ]) &&
    hasTableColumns(database, "job_runs", [
      "id",
      "job_id",
      "entity",
      "status",
      "started_at",
      "finished_at",
      "records_written",
      "error_message",
      "metadata_json",
    ])
  );
}

function hasTableColumns(database: Database.Database, tableName: string, requiredColumns: string[]): boolean {
  const columns = database.prepare(`pragma table_info(${tableName})`).all() as Array<{ name: string }>;
  if (columns.length === 0) {
    return false;
  }

  const columnNames = new Set(columns.map((column) => column.name));
  return requiredColumns.every((column) => columnNames.has(column));
}

function initializeManagedSchema(database: Database.Database): void {
  database.pragma("journal_mode = WAL");
  database.exec(`
    create table if not exists schema_migrations (
      version integer primary key
    );

    create table if not exists records (
      id text primary key,
      project_id text not null,
      entity text not null,
      local_id text not null,
      source text,
      captured_at text,
      payload_json text not null,
      metadata_json text,
      created_at text not null,
      updated_at text not null,
      deleted_at text,
      unique (project_id, entity, local_id)
    );

    create table if not exists job_runs (
      id text primary key,
      job_id text not null,
      entity text,
      status text not null,
      started_at text not null,
      finished_at text,
      records_written integer not null default 0,
      error_message text,
      metadata_json text
    );

    ${BUILT_IN_INDEXES.join(";\n")};
  `);
}

export function loadProjectId(projectConfigPath: string): string {
  try {
    return loadProjectConfig(projectConfigPath).projectId;
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
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
