import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { buildCli } from "../src/cli.js";

const tempDirs: string[] = [];
const repoRoot = path.resolve(__dirname, "..");
const tsxLoader = path.join(repoRoot, "node_modules/tsx/dist/loader.mjs");
const cliEntry = path.join(repoRoot, "src/index.ts");

function makeTempProject(name: string): string {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "agent-pipe-job-run-"));
  const dir = path.join(parent, name);
  fs.mkdirSync(dir, { recursive: true });
  tempDirs.push(parent);
  return dir;
}

function runCli(cwd: string, args: string[], env?: NodeJS.ProcessEnv): { stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, ["--import", tsxLoader, cliEntry, ...args], {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { stdout, stderr: "" };
  } catch (error) {
    const failure = error as {
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      message: string;
    };
    return {
      stdout: typeof failure.stdout === "string" ? failure.stdout : failure.stdout?.toString("utf8") ?? "",
      stderr: typeof failure.stderr === "string" ? failure.stderr : failure.stderr?.toString("utf8") ?? "",
    };
  }
}

function writeSchedules(projectDir: string, jobsBlock: string): void {
  fs.writeFileSync(
    path.join(projectDir, ".agent-pipe", "schedules.yaml"),
    `entities:
  coins_list:
    idFields:
      - id
jobs:
${jobsBlock}
`,
    "utf8",
  );
}

function writeScript(projectDir: string, fileName: string, content: string): void {
  fs.writeFileSync(path.join(projectDir, fileName), content, "utf8");
}

function writeProjectYaml(projectDir: string, lines: string[]): void {
  fs.writeFileSync(path.join(projectDir, ".agent-pipe/project.yaml"), `${lines.join("\n")}\n`, "utf8");
}

function withDatabase(projectDir: string, fn: (database: Database.Database) => void, databaseName = "local"): void {
  const database = new Database(path.join(projectDir, `.agent-pipe/data/${databaseName}.sqlite`));
  try {
    fn(database);
  } finally {
    database.close();
  }
}

function readRecords(projectDir: string, databaseName = "local"): Array<Record<string, unknown>> {
  const database = new Database(path.join(projectDir, `.agent-pipe/data/${databaseName}.sqlite`), { readonly: true });
  try {
    return database
      .prepare("select id, source, payload_json, metadata_json from records order by id")
      .all() as Array<Record<string, unknown>>;
  } finally {
    database.close();
  }
}

function readJobRuns(projectDir: string, databaseName = "local"): Array<Record<string, unknown>> {
  const database = new Database(path.join(projectDir, `.agent-pipe/data/${databaseName}.sqlite`), { readonly: true });
  try {
    return database
      .prepare(
        "select id, job_id, entity, status, records_written, error_message, metadata_json from job_runs order by started_at, id",
      )
      .all() as Array<Record<string, unknown>>;
  } finally {
    database.close();
  }
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("buildCli", () => {
  it("registers the phase 4 run command", () => {
    const program = buildCli();

    expect(program.commands.map((command) => command.name())).toContain("run");
  });
});

describe("agent-pipe run --job", () => {
  it("runs a configured job that prints one object", () => {
    const projectDir = makeTempProject("job-run-object");
    runCli(projectDir, ["init"]);
    writeScript(projectDir, "collect-one.mjs", 'console.log(JSON.stringify({ id: "bitcoin", symbol: "btc" }));\n');
    writeSchedules(
      projectDir,
      [
        "  collect_prices:",
        "    entity: coins_list",
        "    command: node ./collect-one.mjs",
      ].join("\n"),
    );

    const result = runCli(projectDir, ["run", "--job", "collect_prices"]);

    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      jobId: "collect_prices",
      entity: "coins_list",
      recordsWritten: 1,
      jobRunId: expect.any(String),
    });
    expect(readRecords(projectDir)).toEqual([
      {
        id: 'job-run-object:coins_list:["bitcoin"]',
        source: "collect_prices",
        payload_json: JSON.stringify({ id: "bitcoin", symbol: "btc" }),
        metadata_json: JSON.stringify({
          jobId: "collect_prices",
          command: "node ./collect-one.mjs",
          ingestionType: "job",
        }),
      },
    ]);
  });

  it("runs a configured job that prints an array of objects and writes succeeded run metadata", () => {
    const projectDir = makeTempProject("job-run-array");
    runCli(projectDir, ["init"]);
    writeScript(
      projectDir,
      "collect-many.mjs",
      'console.log(JSON.stringify([{ id: "bitcoin" }, { id: "ethereum" }]));\n',
    );
    writeSchedules(
      projectDir,
      [
        "  collect_prices:",
        "    entity: coins_list",
        "    command: node ./collect-many.mjs",
      ].join("\n"),
    );

    const result = JSON.parse(runCli(projectDir, ["run", "--job", "collect_prices"]).stdout) as {
      jobRunId: string;
    };

    expect(readRecords(projectDir).map((row) => row.source)).toEqual(["collect_prices", "collect_prices"]);
    expect(readJobRuns(projectDir)).toEqual([
      {
        id: result.jobRunId,
        job_id: "collect_prices",
        entity: "coins_list",
        status: "succeeded",
        records_written: 2,
        error_message: null,
        metadata_json: expect.stringContaining('"jobId":"collect_prices"'),
      },
    ]);
    expect(JSON.parse(String(readJobRuns(projectDir)[0].metadata_json))).toEqual({
      jobId: "collect_prices",
      command: "node ./collect-many.mjs",
      exitCode: 0,
      durationMs: expect.any(Number),
      timeoutMs: 60000,
    });
  });

  it("is idempotent on rerun through existing upsert behavior", () => {
    const projectDir = makeTempProject("job-run-rerun");
    runCli(projectDir, ["init"]);
    writeScript(projectDir, "collect-rerun.mjs", 'console.log(JSON.stringify({ id: "bitcoin", price: 2 }));\n');
    writeSchedules(
      projectDir,
      [
        "  collect_prices:",
        "    entity: coins_list",
        "    command: node ./collect-rerun.mjs",
      ].join("\n"),
    );

    runCli(projectDir, ["run", "--job", "collect_prices"]);
    runCli(projectDir, ["run", "--job", "collect_prices"]);

    const records = readRecords(projectDir);
    expect(records).toHaveLength(1);
    expect(records[0]?.id).toBe('job-run-rerun:coins_list:["bitcoin"]');
    expect(readJobRuns(projectDir)).toHaveLength(2);
    expect(readJobRuns(projectDir).every((row) => row.status === "succeeded")).toBe(true);
  });

  it("loads .env.local for child commands and keeps process env precedence", () => {
    const projectDir = makeTempProject("job-run-env");
    runCli(projectDir, ["init"]);
    fs.writeFileSync(path.join(projectDir, ".agent-pipe", ".env.local"), "API_KEY=from-file\nSHARED=file\n", "utf8");
    writeScript(
      projectDir,
      "read-env.mjs",
      'console.log(JSON.stringify({ id: process.env.API_KEY, shared: process.env.SHARED }));\n',
    );
    writeSchedules(
      projectDir,
      [
        "  collect_prices:",
        "    entity: coins_list",
        "    command: node ./read-env.mjs",
      ].join("\n"),
    );

    const fromFile = runCli(projectDir, ["run", "--job", "collect_prices"]);
    expect(fromFile.stderr).toBe("");
    expect(JSON.parse(String(readRecords(projectDir)[0]?.payload_json))).toEqual({
      id: "from-file",
      shared: "file",
    });

    const overrideDir = makeTempProject("job-run-env-override");
    runCli(overrideDir, ["init"]);
    fs.writeFileSync(path.join(overrideDir, ".agent-pipe", ".env.local"), "API_KEY=from-file\nSHARED=file\n", "utf8");
    writeScript(
      overrideDir,
      "read-env.mjs",
      'console.log(JSON.stringify({ id: process.env.API_KEY, shared: process.env.SHARED }));\n',
    );
    writeSchedules(
      overrideDir,
      [
        "  collect_prices:",
        "    entity: coins_list",
        "    command: node ./read-env.mjs",
      ].join("\n"),
    );

    const overridden = runCli(overrideDir, ["run", "--job", "collect_prices"], {
      API_KEY: "from-process",
      SHARED: "process",
    });
    expect(overridden.stderr).toBe("");
    expect(JSON.parse(String(readRecords(overrideDir)[0]?.payload_json))).toEqual({
      id: "from-process",
      shared: "process",
    });
  });

  it("fails runs for non-zero exit and caps the stored error snippet", () => {
    const projectDir = makeTempProject("job-run-fail");
    runCli(projectDir, ["init"]);
    writeScript(projectDir, "fail.mjs", `console.error("${"x".repeat(1205)}"); process.exit(2);\n`);
    writeSchedules(
      projectDir,
      [
        "  collect_prices:",
        "    entity: coins_list",
        "    command: node ./fail.mjs",
      ].join("\n"),
    );

    const result = runCli(projectDir, ["run", "--job", "collect_prices"]);

    expect(result.stderr.trim().length).toBe(1000);
    expect(readJobRuns(projectDir)).toEqual([
      {
        id: expect.any(String),
        job_id: "collect_prices",
        entity: "coins_list",
        status: "failed",
        records_written: 0,
        error_message: "x".repeat(1000),
        metadata_json: expect.stringContaining('"exitCode":2'),
      },
    ]);
  });

  it("fails runs for invalid stdout json", () => {
    const projectDir = makeTempProject("job-run-invalid-json");
    runCli(projectDir, ["init"]);
    writeScript(projectDir, "bad-json.mjs", 'console.log("{bad");\n');
    writeSchedules(
      projectDir,
      [
        "  collect_prices:",
        "    entity: coins_list",
        "    command: node ./bad-json.mjs",
      ].join("\n"),
    );

    const result = runCli(projectDir, ["run", "--job", "collect_prices"]);

    expect(result.stderr).toContain('job "collect_prices" must print valid JSON');
    expect(readJobRuns(projectDir)[0]?.status).toBe("failed");
  });

  it("fails runs for missing id fields", () => {
    const projectDir = makeTempProject("job-run-missing-id");
    runCli(projectDir, ["init"]);
    writeScript(projectDir, "missing-id.mjs", 'console.log(JSON.stringify({ symbol: "btc" }));\n');
    writeSchedules(
      projectDir,
      [
        "  collect_prices:",
        "    entity: coins_list",
        "    command: node ./missing-id.mjs",
      ].join("\n"),
    );

    const result = runCli(projectDir, ["run", "--job", "collect_prices"]);

    expect(result.stderr).toContain('missing id field "id" for entity "coins_list"');
    expect(readJobRuns(projectDir)[0]?.status).toBe("failed");
  });

  it("fails runs on timeout and records the failure", () => {
    const projectDir = makeTempProject("job-run-timeout");
    runCli(projectDir, ["init"]);
    writeScript(
      projectDir,
      "slow.mjs",
      'await new Promise((resolve) => setTimeout(resolve, 200)); console.log(JSON.stringify({ id: "late" }));\n',
    );
    writeSchedules(
      projectDir,
      [
        "  collect_prices:",
        "    entity: coins_list",
        "    command: node ./slow.mjs",
        "    timeoutMs: 50",
      ].join("\n"),
    );

    const result = runCli(projectDir, ["run", "--job", "collect_prices"]);

    expect(result.stderr).toContain('job "collect_prices" timed out');
    expect(readJobRuns(projectDir)[0]?.status).toBe("failed");
  });

  it("fails clearly for unknown jobs", () => {
    const projectDir = makeTempProject("job-run-unknown");
    runCli(projectDir, ["init"]);

    const result = runCli(projectDir, ["run", "--job", "missing_job"]);

    expect(result.stderr).toContain('unknown job "missing_job"');
    expect(readJobRuns(projectDir)).toEqual([
      {
        id: expect.any(String),
        job_id: "missing_job",
        entity: "unknown",
        status: "failed",
        records_written: 0,
        error_message: 'unknown job "missing_job"; configured jobs: (none)',
        metadata_json: JSON.stringify({
          jobId: "missing_job",
          command: null,
          exitCode: null,
          durationMs: null,
          timeoutMs: null,
        }),
      },
    ]);
  });

  it("fails clearly for invalid job config and unknown entity", () => {
    const invalidJobDir = makeTempProject("job-run-invalid-job");
    runCli(invalidJobDir, ["init"]);
    writeSchedules(
      invalidJobDir,
      [
        "  broken_job:",
        "    entity: coins_list",
      ].join("\n"),
    );
    expect(runCli(invalidJobDir, ["run", "--job", "broken_job"]).stderr).toContain('invalid job "broken_job"');
    expect(readJobRuns(invalidJobDir)).toEqual([
      {
        id: expect.any(String),
        job_id: "broken_job",
        entity: "unknown",
        status: "failed",
        records_written: 0,
        error_message: 'invalid job "broken_job"',
        metadata_json: JSON.stringify({
          jobId: "broken_job",
          command: null,
          exitCode: null,
          durationMs: null,
          timeoutMs: null,
        }),
      },
    ]);

    const unknownEntityDir = makeTempProject("job-run-unknown-entity");
    runCli(unknownEntityDir, ["init"]);
    fs.writeFileSync(
      path.join(unknownEntityDir, ".agent-pipe", "schedules.yaml"),
      [
        "entities:",
        "  coins_list:",
        "    idFields:",
        "      - id",
        "jobs:",
        "  broken_job:",
        "    entity: missing_entity",
        "    command: node ./missing.mjs",
        "",
      ].join("\n"),
      "utf8",
    );
    expect(runCli(unknownEntityDir, ["run", "--job", "broken_job"]).stderr).toContain(
      'invalid job "broken_job": unknown entity "missing_entity"',
    );
  });

  it("creates a skipped run row for same-job lock conflicts", () => {
    const projectDir = makeTempProject("job-run-lock");
    runCli(projectDir, ["init"]);
    writeScript(projectDir, "collect-one.mjs", 'console.log(JSON.stringify({ id: "bitcoin" }));\n');
    writeSchedules(
      projectDir,
      [
        "  collect_prices:",
        "    entity: coins_list",
        "    command: node ./collect-one.mjs",
      ].join("\n"),
    );
    withDatabase(projectDir, (database) => {
      database
        .prepare(
          "insert into job_runs (id, job_id, entity, status, started_at, finished_at, records_written, error_message, metadata_json) values (?, ?, ?, 'running', ?, null, 0, null, ?)",
        )
        .run("existing-run", "collect_prices", "coins_list", "2026-07-05T00:00:00.000Z", '{"jobId":"collect_prices"}');
    });

    const result = runCli(projectDir, ["run", "--job", "collect_prices"]);

    expect(result.stderr).toContain('job "collect_prices" is already running');
    const runs = readJobRuns(projectDir);
    expect(runs).toHaveLength(2);
    expect(runs[1]).toEqual({
      id: expect.any(String),
      job_id: "collect_prices",
      entity: "coins_list",
      status: "skipped",
      records_written: 0,
      error_message: 'job "collect_prices" is already running',
      metadata_json: expect.stringContaining('"timeoutMs":60000'),
    });
  });

  it("writes job records and run history to the configured job database", () => {
    const projectDir = makeTempProject("job-run-research");
    runCli(projectDir, ["init"]);
    writeProjectYaml(projectDir, [
      "projectId: job-run-research",
      'projectName: "Job Run Research"',
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
    writeScript(projectDir, "collect-research.mjs", 'console.log(JSON.stringify({ id: "bitcoin" }));\n');
    writeSchedules(
      projectDir,
      [
        "  collect_prices:",
        "    database: research",
        "    entity: coins_list",
        "    command: node ./collect-research.mjs",
      ].join("\n"),
    );

    const result = JSON.parse(runCli(projectDir, ["run", "--job", "collect_prices"]).stdout) as { jobRunId: string };

    expect(fs.existsSync(path.join(projectDir, ".agent-pipe/data/research.sqlite"))).toBe(true);
    expect(readRecords(projectDir, "local")).toHaveLength(0);
    expect(readRecords(projectDir, "research")).toHaveLength(1);
    expect(readJobRuns(projectDir, "local")).toHaveLength(0);
    expect(readJobRuns(projectDir, "research")[0]?.id).toBe(result.jobRunId);
  });

  it("fails clearly for unknown configured job databases", () => {
    const projectDir = makeTempProject("job-run-unknown-db");
    runCli(projectDir, ["init"]);
    writeScript(projectDir, "collect-one.mjs", 'console.log(JSON.stringify({ id: "bitcoin" }));\n');
    writeSchedules(
      projectDir,
      [
        "  collect_prices:",
        "    database: missing",
        "    entity: coins_list",
        "    command: node ./collect-one.mjs",
      ].join("\n"),
    );

    const result = runCli(projectDir, ["run", "--job", "collect_prices"]);

    expect(result.stderr).toContain('unknown database "missing" for job "collect_prices"');
    expect(readJobRuns(projectDir)[0]?.status).toBe("failed");
  });
});
