import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import {
  findParentProjectRoot,
  humanizeProjectId,
  normalizeProjectId,
  validateProjectId,
} from "./project.js";

type InitOptions = {
  projectId?: string;
  projectName?: string;
};

type InitResult = {
  projectId: string;
  projectName: string;
  paths: {
    root: string;
    projectConfig: string;
    schedulesConfig: string;
    database: string;
    logs: string;
  };
};

const SUPPORTED_SCHEMA_VERSION = 1;

export function runInit(cwd: string, options: InitOptions): InitResult {
  assertNoParentProject(cwd);

  const rootDir = path.resolve(cwd);
  const stateDir = path.join(rootDir, ".agent-pipe");
  const dataDir = path.join(stateDir, "data");
  const logsDir = path.join(stateDir, "logs");
  const databasePath = path.join(dataDir, "local.sqlite");

  const projectId = validateProjectId(
    options.projectId ?? normalizeProjectId(path.basename(rootDir)),
  );
  const projectName = options.projectName?.trim() || humanizeProjectId(projectId);

  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(logsDir, { recursive: true });

  writeIfMissing(
    path.join(stateDir, "project.yaml"),
    `projectId: ${projectId}\nprojectName: ${toYamlString(projectName)}\n`,
  );
  writeIfMissing(
    path.join(stateDir, "schedules.yaml"),
    "entities:\n  coins_list:\n    idFields:\n      - id\njobs: []\n",
  );

  bootstrapDatabase(databasePath);

  return {
    projectId,
    projectName,
    paths: {
      root: ".agent-pipe",
      projectConfig: ".agent-pipe/project.yaml",
      schedulesConfig: ".agent-pipe/schedules.yaml",
      database: ".agent-pipe/data/local.sqlite",
      logs: ".agent-pipe/logs",
    },
  };
}

function assertNoParentProject(startDir: string): void {
  const parentRoot = findParentProjectRoot(startDir);
  if (parentRoot) {
    throw new Error(`nested projects are not supported; parent project found at ${parentRoot}`);
  }
}

function writeIfMissing(filePath: string, content: string): void {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, content, "utf8");
  }
}

export function bootstrapDatabase(databasePath: string): void {
  const database = new Database(databasePath);
  try {
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
    `);

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

function toYamlString(value: string): string {
  return JSON.stringify(value);
}
