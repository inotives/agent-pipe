import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import {
  bootstrapProjectDatabase,
  ensureSupportedSchemaVersion,
  inspectProjectDatabaseStatus,
  loadProjectConfig,
  resolveProjectDatabase,
} from "../src/runtime.js";

const tempDirs: string[] = [];

function makeStateDir(name: string): string {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "agent-pipe-test-"));
  const rootDir = path.join(parent, name);
  const stateDir = path.join(rootDir, ".agent-pipe");
  fs.mkdirSync(path.join(stateDir, "data"), { recursive: true });
  tempDirs.push(parent);
  return stateDir;
}

function writeProjectYaml(stateDir: string, content: string): string {
  const projectConfigPath = path.join(stateDir, "project.yaml");
  fs.writeFileSync(projectConfigPath, content, "utf8");
  return projectConfigPath;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("loadProjectConfig", () => {
  it("parses the Phase 6 database shape", () => {
    const stateDir = makeStateDir("phase-6-config");
    const projectConfigPath = writeProjectYaml(
      stateDir,
      [
        "projectId: agent-pipe",
        'projectName: "Agent Pipe"',
        "defaultDatabase: local",
        "databases:",
        "  local:",
        "    type: sqlite",
        "    path: data/local.sqlite",
        "  research:",
        "    type: sqlite",
        "    path: data/research.sqlite",
        "",
      ].join("\n"),
    );

    expect(loadProjectConfig(projectConfigPath)).toEqual({
      projectId: "agent-pipe",
      projectName: "Agent Pipe",
      defaultDatabase: "local",
      databases: {
        local: {
          type: "sqlite",
          path: "data/local.sqlite",
          absolutePath: path.join(stateDir, "data/local.sqlite"),
        },
        research: {
          type: "sqlite",
          path: "data/research.sqlite",
          absolutePath: path.join(stateDir, "data/research.sqlite"),
        },
      },
    });
  });

  it("keeps Phase 5 config compatible by defaulting to local sqlite", () => {
    const stateDir = makeStateDir("phase-5-config");
    const projectConfigPath = writeProjectYaml(
      stateDir,
      'projectId: legacy-project\nprojectName: "Legacy Project"\n',
    );

    expect(loadProjectConfig(projectConfigPath)).toEqual({
      projectId: "legacy-project",
      projectName: "Legacy Project",
      defaultDatabase: "local",
      databases: {
        local: {
          type: "sqlite",
          path: "data/local.sqlite",
          absolutePath: path.join(stateDir, "data/local.sqlite"),
        },
      },
    });
  });

  it("fails clearly when the default database is not configured", () => {
    const stateDir = makeStateDir("missing-default");
    const projectConfigPath = writeProjectYaml(
      stateDir,
      [
        "projectId: agent-pipe",
        "defaultDatabase: missing",
        "databases:",
        "  local:",
        "    type: sqlite",
        "    path: data/local.sqlite",
        "",
      ].join("\n"),
    );

    expect(() => loadProjectConfig(projectConfigPath)).toThrow(
      'default database "missing" is not configured',
    );
  });

  it("fails clearly for unsupported database types", () => {
    const stateDir = makeStateDir("unsupported-type");
    const projectConfigPath = writeProjectYaml(
      stateDir,
      [
        "projectId: agent-pipe",
        "defaultDatabase: local",
        "databases:",
        "  local:",
        "    type: postgres",
        "    path: data/local.sqlite",
        "",
      ].join("\n"),
    );

    expect(() => loadProjectConfig(projectConfigPath)).toThrow(
      'database "local" has unsupported type "postgres"; only sqlite is supported',
    );
  });

  it("fails clearly for database paths outside .agent-pipe/data", () => {
    const stateDir = makeStateDir("unsafe-path");
    const projectConfigPath = writeProjectYaml(
      stateDir,
      [
        "projectId: agent-pipe",
        "defaultDatabase: local",
        "databases:",
        "  local:",
        "    type: sqlite",
        "    path: ../local.sqlite",
        "",
      ].join("\n"),
    );

    expect(() => loadProjectConfig(projectConfigPath)).toThrow(
      'database "local" path must stay under .agent-pipe/data/',
    );
  });
});

describe("resolveProjectDatabase", () => {
  it("resolves the default database and named databases", () => {
    const stateDir = makeStateDir("resolve-db");
    const projectConfigPath = writeProjectYaml(
      stateDir,
      [
        "projectId: agent-pipe",
        "defaultDatabase: local",
        "databases:",
        "  local:",
        "    type: sqlite",
        "    path: data/local.sqlite",
        "  research:",
        "    type: sqlite",
        "    path: data/research.sqlite",
        "",
      ].join("\n"),
    );

    expect(resolveProjectDatabase(projectConfigPath)).toEqual({
      name: "local",
      type: "sqlite",
      path: "data/local.sqlite",
      absolutePath: path.join(stateDir, "data/local.sqlite"),
    });
    expect(resolveProjectDatabase(projectConfigPath, "research")).toEqual({
      name: "research",
      type: "sqlite",
      path: "data/research.sqlite",
      absolutePath: path.join(stateDir, "data/research.sqlite"),
    });
  });
});

describe("bootstrapProjectDatabase", () => {
  it("bootstraps multiple configured sqlite databases with built-in indexes", () => {
    const stateDir = makeStateDir("bootstrap-multi-db");
    const databasePaths = [
      path.join(stateDir, "data/local.sqlite"),
      path.join(stateDir, "data/research.sqlite"),
    ];

    for (const databasePath of databasePaths) {
      bootstrapProjectDatabase(databasePath);
    }

    for (const databasePath of databasePaths) {
      const database = new Database(databasePath, { readonly: true });
      try {
        const tables = database
          .prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name")
          .all() as Array<{ name: string }>;
        const indexes = database
          .prepare("select name from sqlite_master where type = 'index' and name like 'idx_%' order by name")
          .all() as Array<{ name: string }>;
        const versions = database.prepare("select version from schema_migrations").all() as Array<{ version: number }>;

        expect(tables.map((row) => row.name)).toEqual(["job_runs", "records", "schema_migrations"]);
        expect(indexes.map((row) => row.name)).toEqual([
          "idx_job_runs_job_id",
          "idx_job_runs_started_at",
          "idx_job_runs_status",
          "idx_records_deleted_at",
          "idx_records_entity",
          "idx_records_source",
          "idx_records_updated_at",
        ]);
        expect(versions).toEqual([{ version: 1 }]);
      } finally {
        database.close();
      }
    }
  });

  it("is idempotent on repeated bootstrap", () => {
    const stateDir = makeStateDir("bootstrap-idempotent");
    const databasePath = path.join(stateDir, "data/local.sqlite");

    bootstrapProjectDatabase(databasePath);
    bootstrapProjectDatabase(databasePath);

    const database = new Database(databasePath, { readonly: true });
    try {
      const versions = database.prepare("select version from schema_migrations order by version").all() as Array<{
        version: number;
      }>;
      const indexCount = database
        .prepare("select count(*) as count from sqlite_master where type = 'index' and name like 'idx_%'")
        .get() as { count: number };

      expect(versions).toEqual([{ version: 1 }]);
      expect(indexCount.count).toBe(7);
    } finally {
      database.close();
    }
  });

  it("replaces incompatible pre-release sqlite files directly", () => {
    const stateDir = makeStateDir("bootstrap-replace");
    const databasePath = path.join(stateDir, "data/local.sqlite");
    const database = new Database(databasePath);
    database.exec(`
      create table records (
        id text primary key
      );
      insert into records (id) values ('stale');
    `);
    database.close();

    bootstrapProjectDatabase(databasePath);

    const managedDatabase = new Database(databasePath, { readonly: true });
    try {
      const versions = managedDatabase.prepare("select version from schema_migrations").all() as Array<{
        version: number;
      }>;
      const recordsCount = managedDatabase.prepare("select count(*) as count from records").get() as { count: number };

      expect(versions).toEqual([{ version: 1 }]);
      expect(recordsCount.count).toBe(0);
    } finally {
      managedDatabase.close();
    }
  });

  it("replaces legacy sqlite files that still have schema_migrations but lack the managed column shape", () => {
    const stateDir = makeStateDir("bootstrap-replace-legacy-shape");
    const databasePath = path.join(stateDir, "data/local.sqlite");
    const database = new Database(databasePath);
    database.exec(`
      create table schema_migrations (version integer primary key);
      insert into schema_migrations (version) values (1);
      create table records (
        entity text not null,
        record_id text not null,
        payload_json text not null,
        created_at text not null,
        updated_at text not null
      );
      create table job_runs (
        job_id text not null,
        started_at text not null,
        completed_at text,
        status text not null
      );
      insert into records (entity, record_id, payload_json, created_at, updated_at)
      values ('coins_list', 'bitcoin', '{}', '2026-07-07T00:00:00.000Z', '2026-07-07T00:00:00.000Z');
    `);
    database.close();

    bootstrapProjectDatabase(databasePath);

    const managedDatabase = new Database(databasePath, { readonly: true });
    try {
      const versions = managedDatabase.prepare("select version from schema_migrations").all() as Array<{ version: number }>;
      const columns = managedDatabase.prepare("pragma table_info(records)").all() as Array<{ name: string }>;
      const recordsCount = managedDatabase.prepare("select count(*) as count from records").get() as { count: number };

      expect(versions).toEqual([{ version: 1 }]);
      expect(columns.map((column) => column.name)).toEqual([
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
      ]);
      expect(recordsCount.count).toBe(0);
    } finally {
      managedDatabase.close();
    }
  });

  it("still rejects unsupported managed schema versions clearly", () => {
    const stateDir = makeStateDir("bootstrap-unsupported");
    const databasePath = path.join(stateDir, "data/local.sqlite");
    const database = new Database(databasePath);
    database.exec(`
      create table schema_migrations (version integer primary key);
      insert into schema_migrations (version) values (2);
      create table records (
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
        deleted_at text
      );
      create table job_runs (
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
    database.close();

    expect(() => bootstrapProjectDatabase(databasePath)).toThrow(/unsupported schema version: found 2/);
  });
});

describe("ensureSupportedSchemaVersion", () => {
  it("records schema version 1 for a fresh managed database", () => {
    const database = new Database(":memory:");
    database.exec("create table schema_migrations (version integer primary key)");

    ensureSupportedSchemaVersion(database);

    expect(database.prepare("select version from schema_migrations").all()).toEqual([{ version: 1 }]);
    database.close();
  });
});

describe("inspectProjectDatabaseStatus", () => {
  it("reports legacy schema-migrations databases with incompatible table shapes as incompatible_pre_release", () => {
    const stateDir = makeStateDir("status-legacy-shape");
    const projectConfigPath = writeProjectYaml(
      stateDir,
      ['projectId: status-legacy-shape', "defaultDatabase: local", ""].join("\n"),
    );
    const databasePath = path.join(stateDir, "data/local.sqlite");
    const database = new Database(databasePath);
    database.exec(`
      create table schema_migrations (version integer primary key);
      insert into schema_migrations (version) values (1);
      create table records (
        entity text not null,
        record_id text not null,
        payload_json text not null,
        created_at text not null,
        updated_at text not null
      );
      create table job_runs (
        job_id text not null,
        started_at text not null,
        completed_at text,
        status text not null
      );
    `);
    database.close();

    expect(inspectProjectDatabaseStatus(resolveProjectDatabase(projectConfigPath))).toMatchObject({
      database: "local",
      exists: true,
      schemaStatus: "incompatible_pre_release",
      schemaVersion: null,
      tables: {
        schema_migrations: true,
        records: true,
        job_runs: true,
      },
    });
  });
});
