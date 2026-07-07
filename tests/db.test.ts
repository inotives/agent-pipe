import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];
const repoRoot = path.resolve(__dirname, "..");
const tsxLoader = path.join(repoRoot, "node_modules/tsx/dist/loader.mjs");
const cliEntry = path.join(repoRoot, "src/index.ts");

function makeTempProject(name: string): string {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "agent-pipe-test-"));
  const dir = path.join(parent, name);
  fs.mkdirSync(dir, { recursive: true });
  tempDirs.push(parent);
  return dir;
}

function runCli(cwd: string, args: string[]): { stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, ["--import", tsxLoader, cliEntry, ...args], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { stdout, stderr: "" };
  } catch (error) {
    const failure = error as { stdout?: string | Buffer; stderr?: string | Buffer; message: string };
    throw new Error(
      [
        failure.message,
        typeof failure.stdout === "string" ? failure.stdout : failure.stdout?.toString("utf8") ?? "",
        typeof failure.stderr === "string" ? failure.stderr : failure.stderr?.toString("utf8") ?? "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
}

function writeProjectYaml(projectDir: string, lines: string[]): void {
  fs.writeFileSync(path.join(projectDir, ".agent-pipe/project.yaml"), `${lines.join("\n")}\n`, "utf8");
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("agent-pipe db", () => {
  it("db init bootstraps all configured databases and is safe to rerun", () => {
    const projectDir = makeTempProject("db-init");
    runCli(projectDir, ["init"]);
    writeProjectYaml(projectDir, [
      "projectId: db-init",
      'projectName: "Db Init"',
      "defaultDatabase: local",
      "databases:",
      "  local:",
      "    type: sqlite",
      "    path: data/local.sqlite",
      "  research:",
      "    type: sqlite",
      "    path: data/research.sqlite",
    ]);
    fs.rmSync(path.join(projectDir, ".agent-pipe/data/research.sqlite"), { force: true });

    const first = JSON.parse(runCli(projectDir, ["db", "init"]).stdout) as {
      databases: Array<{
        database: string;
        exists: boolean;
        schemaStatus: string;
        tables: Record<string, boolean>;
        indexes: Record<string, boolean>;
      }>;
    };
    const second = JSON.parse(runCli(projectDir, ["db", "init"]).stdout) as typeof first;

    expect(first.databases.map((row) => row.database)).toEqual(["local", "research"]);
    expect(second.databases.map((row) => row.database)).toEqual(["local", "research"]);
    for (const row of second.databases) {
      expect(row.exists).toBe(true);
      expect(row.schemaStatus).toBe("ok");
      expect(Object.values(row.tables).every(Boolean)).toBe(true);
      expect(Object.values(row.indexes).every(Boolean)).toBe(true);
    }
  });

  it("db status reports missing configured databases as json", () => {
    const projectDir = makeTempProject("db-status-missing");
    runCli(projectDir, ["init"]);
    writeProjectYaml(projectDir, [
      "projectId: db-status-missing",
      'projectName: "Db Status Missing"',
      "defaultDatabase: local",
      "databases:",
      "  local:",
      "    type: sqlite",
      "    path: data/local.sqlite",
      "  research:",
      "    type: sqlite",
      "    path: data/research.sqlite",
    ]);
    fs.rmSync(path.join(projectDir, ".agent-pipe/data/research.sqlite"), { force: true });

    const output = JSON.parse(runCli(projectDir, ["db", "status"]).stdout) as {
      databases: Array<{
        database: string;
        configuredPath: string;
        absolutePath: string;
        exists: boolean;
        schemaStatus: string;
        schemaVersion: number | null;
        tables: Record<string, boolean>;
        indexes: Record<string, boolean>;
      }>;
    };

    expect(output.databases).toHaveLength(2);
    expect(output.databases[1]).toMatchObject({
      database: "research",
      configuredPath: "data/research.sqlite",
      exists: false,
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
    });
    expect(output.databases[1]?.absolutePath).toBe(
      fs.realpathSync(path.join(projectDir, ".agent-pipe/data")).replace(/\/data$/, "/data/research.sqlite"),
    );
  });

  it("db status reports incompatible pre-release databases without mutating them", () => {
    const projectDir = makeTempProject("db-status-incompatible");
    runCli(projectDir, ["init"]);
    writeProjectYaml(projectDir, [
      "projectId: db-status-incompatible",
      'projectName: "Db Status Incompatible"',
      "defaultDatabase: local",
      "databases:",
      "  local:",
      "    type: sqlite",
      "    path: data/local.sqlite",
      "  research:",
      "    type: sqlite",
      "    path: data/research.sqlite",
    ]);

    const incompatiblePath = path.join(projectDir, ".agent-pipe/data/research.sqlite");
    const database = new Database(incompatiblePath);
    database.exec(`
      create table records (
        id text primary key
      );
      insert into records (id) values ('stale');
    `);
    database.close();

    const output = JSON.parse(runCli(projectDir, ["db", "status"]).stdout) as {
      databases: Array<{
        database: string;
        schemaStatus: string;
        tables: Record<string, boolean>;
      }>;
    };

    const research = output.databases.find((row) => row.database === "research");
    expect(research).toMatchObject({
      database: "research",
      schemaStatus: "incompatible_pre_release",
      tables: {
        schema_migrations: false,
        records: true,
        job_runs: false,
      },
    });

    const verify = new Database(incompatiblePath, { readonly: true });
    try {
      const count = verify.prepare("select count(*) as count from records").get() as { count: number };
      expect(count.count).toBe(1);
    } finally {
      verify.close();
    }
  });

  it("db status reports legacy schema-migrations databases with incompatible column shapes as incompatible", () => {
    const projectDir = makeTempProject("db-status-legacy-shape");
    runCli(projectDir, ["init"]);

    const legacyPath = path.join(projectDir, ".agent-pipe/data/local.sqlite");
    fs.rmSync(legacyPath, { force: true });
    const database = new Database(legacyPath);
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

    const status = JSON.parse(runCli(projectDir, ["db", "status"]).stdout) as {
      databases: Array<{
        database: string;
        schemaStatus: string;
        schemaVersion: number | null;
        tables: Record<string, boolean>;
      }>;
    };

    expect(status.databases[0]).toMatchObject({
      database: "local",
      schemaStatus: "incompatible_pre_release",
      schemaVersion: null,
      tables: {
        schema_migrations: true,
        records: true,
        job_runs: true,
      },
    });

    const init = JSON.parse(runCli(projectDir, ["db", "init"]).stdout) as {
      databases: Array<{
        database: string;
        exists: boolean;
        schemaStatus: string;
        tables: Record<string, boolean>;
        indexes: Record<string, boolean>;
      }>;
    };

    expect(init.databases[0]).toMatchObject({
      database: "local",
      exists: true,
      schemaStatus: "ok",
    });
    expect(Object.values(init.databases[0]!.tables).every(Boolean)).toBe(true);
    expect(Object.values(init.databases[0]!.indexes).every(Boolean)).toBe(true);
  });

  it("db status fails clearly when project.yaml is missing or invalid", () => {
    const projectDir = makeTempProject("db-status-errors");
    fs.mkdirSync(path.join(projectDir, ".agent-pipe"), { recursive: true });

    expect(() => runCli(projectDir, ["db", "status"])).toThrow(
      /missing \.agent-pipe\/project\.yaml; run `agent-pipe init` first/,
    );

    fs.writeFileSync(path.join(projectDir, ".agent-pipe/project.yaml"), "projectId: []\n", "utf8");

    expect(() => runCli(projectDir, ["db", "status"])).toThrow(/invalid \.agent-pipe\/project\.yaml/);
  });
});
