import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { buildCli } from "../src/cli.js";
import { runSchedulerStart } from "../src/scheduler.js";

const tempDirs: string[] = [];
const repoRoot = path.resolve(__dirname, "..");
const tsxLoader = path.join(repoRoot, "node_modules/tsx/dist/loader.mjs");
const cliEntry = path.join(repoRoot, "src/index.ts");

function makeTempProject(name: string): string {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "agent-pipe-scheduler-"));
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
    const failure = error as {
      stdout?: string | Buffer;
      stderr?: string | Buffer;
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

function writeMultiDatabaseProjectConfig(projectDir: string): void {
  fs.writeFileSync(
    path.join(projectDir, ".agent-pipe", "project.yaml"),
    `projectId: ${path.basename(projectDir)}
projectName: ${path.basename(projectDir)}
defaultDatabase: local
databases:
  local:
    type: sqlite
    path: data/local.sqlite
  research:
    type: sqlite
    path: data/research.sqlite
`,
    "utf8",
  );
}

function readRecords(projectDir: string, databaseName = "local"): Array<Record<string, unknown>> {
  const database = new Database(path.join(projectDir, `.agent-pipe/data/${databaseName}.sqlite`), { readonly: true });
  try {
    return database.prepare("select id, source from records order by id").all() as Array<Record<string, unknown>>;
  } finally {
    database.close();
  }
}

function readJobRuns(projectDir: string, databaseName = "local"): Array<Record<string, unknown>> {
  const database = new Database(path.join(projectDir, `.agent-pipe/data/${databaseName}.sqlite`), { readonly: true });
  try {
    return database
      .prepare("select job_id, status, records_written, error_message from job_runs order by started_at, id")
      .all() as Array<Record<string, unknown>>;
  } finally {
    database.close();
  }
}

function insertRunningJob(projectDir: string, jobId: string, databaseName = "local"): void {
  const database = new Database(path.join(projectDir, `.agent-pipe/data/${databaseName}.sqlite`));
  try {
    database
      .prepare(
        `
          insert into job_runs (
            id, job_id, entity, status, started_at, finished_at, records_written, error_message, metadata_json
          ) values (?, ?, ?, 'running', ?, null, 0, null, ?)
        `,
      )
      .run(`running-${jobId}`, jobId, "coins_list", new Date("2026-07-06T00:04:00.000Z").toISOString(), "{}");
  } finally {
    database.close();
  }
}

function parseEvents(output: string): Array<Record<string, unknown>> {
  return output
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
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
  it("registers the phase 5 scheduler command", () => {
    const program = buildCli();

    expect(program.commands.map((command) => command.name())).toContain("scheduler");
  });
});

describe("agent-pipe scheduler start --once", () => {
  it("runs a due cron job and records history through the existing job runner", async () => {
    const projectDir = makeTempProject("scheduler-due");
    runCli(projectDir, ["init"]);
    writeScript(projectDir, "collect-one.mjs", 'console.log(JSON.stringify({ id: "bitcoin" }));\n');
    writeSchedules(
      projectDir,
      [
        "  collect_prices:",
        "    entity: coins_list",
        "    command: node ./collect-one.mjs",
        "    schedule:",
        "      type: cron",
        "      expression: \"5 0 * * *\"",
      ].join("\n"),
    );

    const output = await runSchedulerStart(projectDir, {
      once: true,
      now: new Date("2026-07-06T00:05:30.000Z"),
    });

    const events = parseEvents(output);
    expect(events).toEqual([
      {
        event: "scheduler_started",
        timestamp: expect.any(String),
      },
      {
        event: "tick_started",
        timestamp: expect.any(String),
      },
      {
        event: "job_due",
        timestamp: expect.any(String),
        jobId: "collect_prices",
        database: "local",
      },
      {
        event: "job_succeeded",
        timestamp: expect.any(String),
        jobId: "collect_prices",
        database: "local",
        jobRunId: expect.any(String),
        recordsWritten: 1,
      },
      {
        event: "tick_finished",
        timestamp: expect.any(String),
      },
    ]);
    expect(readRecords(projectDir)).toEqual([
      {
        id: 'scheduler-due:coins_list:["bitcoin"]',
        source: "collect_prices",
      },
    ]);
    expect(readJobRuns(projectDir)).toEqual([
      {
        job_id: "collect_prices",
        status: "succeeded",
        records_written: 1,
        error_message: null,
      },
    ]);
  });

  it("does not run manual jobs or jobs with missing schedule", async () => {
    const projectDir = makeTempProject("scheduler-manual");
    runCli(projectDir, ["init"]);
    writeScript(projectDir, "collect-one.mjs", 'console.log(JSON.stringify({ id: "bitcoin" }));\n');
    writeSchedules(
      projectDir,
      [
        "  manual_job:",
        "    entity: coins_list",
        "    command: node ./collect-one.mjs",
        "    schedule:",
        "      type: manual",
        "  legacy_manual_job:",
        "    entity: coins_list",
        "    command: node ./collect-one.mjs",
      ].join("\n"),
    );

    const output = await runSchedulerStart(projectDir, {
      once: true,
      now: new Date("2026-07-06T00:05:30.000Z"),
    });

    expect(parseEvents(output).map((line) => line.event)).toEqual([
      "scheduler_started",
      "tick_started",
      "tick_finished",
    ]);
    expect(readRecords(projectDir)).toEqual([]);
    expect(readJobRuns(projectDir)).toEqual([]);
  });

  it("does not run cron jobs that are not due in the current minute", async () => {
    const projectDir = makeTempProject("scheduler-not-due");
    runCli(projectDir, ["init"]);
    writeScript(projectDir, "collect-one.mjs", 'console.log(JSON.stringify({ id: "bitcoin" }));\n');
    writeSchedules(
      projectDir,
      [
        "  collect_prices:",
        "    entity: coins_list",
        "    command: node ./collect-one.mjs",
        "    schedule:",
        "      type: cron",
        "      expression: \"6 0 * * *\"",
      ].join("\n"),
    );

    const output = await runSchedulerStart(projectDir, {
      once: true,
      now: new Date("2026-07-06T00:05:30.000Z"),
    });

    expect(parseEvents(output).map((line) => line.event)).toEqual([
      "scheduler_started",
      "tick_started",
      "tick_finished",
    ]);
    expect(readRecords(projectDir)).toEqual([]);
    expect(readJobRuns(projectDir)).toEqual([]);
  });

  it("uses the default poll interval for loop mode", async () => {
    const projectDir = makeTempProject("scheduler-default-interval");
    runCli(projectDir, ["init"]);
    writeSchedules(projectDir, "");
    const sleeps: number[] = [];

    const output = await runSchedulerStart(projectDir, {
      maxTicks: 2,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      nowProvider: () => new Date("2026-07-06T00:05:30.000Z"),
    });

    expect(sleeps).toEqual([60000]);
    expect(parseEvents(output).map((line) => line.event)).toEqual([
      "scheduler_started",
      "tick_started",
      "tick_finished",
      "tick_started",
      "tick_finished",
    ]);
  });

  it("accepts poll interval overrides and rejects invalid values", async () => {
    const projectDir = makeTempProject("scheduler-poll-interval");
    runCli(projectDir, ["init"]);
    writeSchedules(projectDir, "");
    const sleeps: number[] = [];

    await runSchedulerStart(projectDir, {
      pollIntervalMs: 1000,
      maxTicks: 2,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      nowProvider: () => new Date("2026-07-06T00:05:30.000Z"),
    });

    expect(sleeps).toEqual([1000]);
    expect(runCli(projectDir, ["scheduler", "start", "--poll-interval-ms", "0"]).stderr).toContain(
      "poll interval must be a positive integer",
    );
    expect(runCli(projectDir, ["scheduler", "start", "--poll-interval-ms", "abc"]).stderr).toContain(
      "poll interval must be a positive integer",
    );
  });

  it("skips only jobs targeting a database with an existing running job", async () => {
    const projectDir = makeTempProject("scheduler-locked");
    runCli(projectDir, ["init"]);
    writeMultiDatabaseProjectConfig(projectDir);
    runCli(projectDir, ["db", "init"]);
    writeScript(projectDir, "collect-local.mjs", 'console.log(JSON.stringify({ id: "bitcoin" }));\n');
    writeScript(projectDir, "collect-research.mjs", 'console.log(JSON.stringify({ id: "ethereum" }));\n');
    writeSchedules(
      projectDir,
      [
        "  collect_local:",
        "    entity: coins_list",
        "    command: node ./collect-local.mjs",
        "    schedule:",
        "      type: cron",
        "      expression: \"5 0 * * *\"",
        "  collect_research:",
        "    database: research",
        "    entity: coins_list",
        "    command: node ./collect-research.mjs",
        "    schedule:",
        "      type: cron",
        "      expression: \"5 0 * * *\"",
      ].join("\n"),
    );
    insertRunningJob(projectDir, "other_job", "local");

    const output = await runSchedulerStart(projectDir, {
      once: true,
      now: new Date("2026-07-06T00:05:30.000Z"),
    });

    const events = parseEvents(output);
    expect(events[0]).toEqual({
      event: "scheduler_started",
      timestamp: expect.any(String),
    });
    expect(events[1]).toEqual({
      event: "tick_started",
      timestamp: expect.any(String),
    });
    expect(events.at(-1)).toEqual({
      event: "tick_finished",
      timestamp: expect.any(String),
    });
    expect(events).toEqual(
      expect.arrayContaining([
        {
          event: "job_due",
          timestamp: expect.any(String),
          jobId: "collect_local",
          database: "local",
        },
        {
          event: "job_skipped",
          timestamp: expect.any(String),
          jobId: "collect_local",
          database: "local",
          errorMessage: "scheduler skipped job because another job is already running in this database",
        },
        {
          event: "job_due",
          timestamp: expect.any(String),
          jobId: "collect_research",
          database: "research",
        },
        {
          event: "job_succeeded",
          timestamp: expect.any(String),
          jobId: "collect_research",
          database: "research",
          jobRunId: expect.any(String),
          recordsWritten: 1,
        },
      ]),
    );
    expect(readRecords(projectDir)).toEqual([]);
    expect(readRecords(projectDir, "research")).toEqual([
      {
        id: 'scheduler-locked:coins_list:["ethereum"]',
        source: "collect_research",
      },
    ]);
  });

  it("emits job_failed and leaves failed run history for failed scheduled jobs", async () => {
    const projectDir = makeTempProject("scheduler-failed");
    runCli(projectDir, ["init"]);
    writeScript(projectDir, "fail.mjs", "process.exit(2);\n");
    writeSchedules(
      projectDir,
      [
        "  collect_prices:",
        "    entity: coins_list",
        "    command: node ./fail.mjs",
        "    schedule:",
        "      type: cron",
        "      expression: \"5 0 * * *\"",
      ].join("\n"),
    );

    const output = await runSchedulerStart(projectDir, {
      once: true,
      now: new Date("2026-07-06T00:05:30.000Z"),
    });

    expect(parseEvents(output)).toEqual([
      {
        event: "scheduler_started",
        timestamp: expect.any(String),
      },
      {
        event: "tick_started",
        timestamp: expect.any(String),
      },
      {
        event: "job_due",
        timestamp: expect.any(String),
        jobId: "collect_prices",
        database: "local",
      },
      {
        event: "job_failed",
        timestamp: expect.any(String),
        jobId: "collect_prices",
        database: "local",
        errorMessage: expect.any(String),
      },
      {
        event: "tick_finished",
        timestamp: expect.any(String),
      },
    ]);
    expect(readJobRuns(projectDir)).toEqual([
      {
        job_id: "collect_prices",
        status: "failed",
        records_written: 0,
        error_message: expect.any(String),
      },
    ]);
  });

  it("runs due jobs for different databases in the same tick", async () => {
    const projectDir = makeTempProject("scheduler-multi-db");
    runCli(projectDir, ["init"]);
    writeMultiDatabaseProjectConfig(projectDir);
    writeScript(projectDir, "collect-local.mjs", 'console.log(JSON.stringify({ id: "bitcoin" }));\n');
    writeScript(projectDir, "collect-research.mjs", 'console.log(JSON.stringify({ id: "ethereum" }));\n');
    writeSchedules(
      projectDir,
      [
        "  collect_local:",
        "    database: local",
        "    entity: coins_list",
        "    command: node ./collect-local.mjs",
        "    schedule:",
        "      type: cron",
        "      expression: \"5 0 * * *\"",
        "  collect_research:",
        "    database: research",
        "    entity: coins_list",
        "    command: node ./collect-research.mjs",
        "    schedule:",
        "      type: cron",
        "      expression: \"5 0 * * *\"",
      ].join("\n"),
    );

    const events = parseEvents(
      await runSchedulerStart(projectDir, {
        once: true,
        now: new Date("2026-07-06T00:05:30.000Z"),
      }),
    );

    expect(events[0]?.event).toBe("scheduler_started");
    expect(events[1]?.event).toBe("tick_started");
    expect(events.at(-1)?.event).toBe("tick_finished");
    expect(events).toEqual(
      expect.arrayContaining([
        {
          event: "job_due",
          timestamp: expect.any(String),
          jobId: "collect_local",
          database: "local",
        },
        {
          event: "job_succeeded",
          timestamp: expect.any(String),
          jobId: "collect_local",
          database: "local",
          jobRunId: expect.any(String),
          recordsWritten: 1,
        },
        {
          event: "job_due",
          timestamp: expect.any(String),
          jobId: "collect_research",
          database: "research",
        },
        {
          event: "job_succeeded",
          timestamp: expect.any(String),
          jobId: "collect_research",
          database: "research",
          jobRunId: expect.any(String),
          recordsWritten: 1,
        },
      ]),
    );
    expect(readRecords(projectDir)).toEqual([
      {
        id: 'scheduler-multi-db:coins_list:["bitcoin"]',
        source: "collect_local",
      },
    ]);
    expect(readRecords(projectDir, "research")).toEqual([
      {
        id: 'scheduler-multi-db:coins_list:["ethereum"]',
        source: "collect_research",
      },
    ]);
  });

  it("runs due jobs for the same database sequentially in one tick", async () => {
    const projectDir = makeTempProject("scheduler-same-db");
    runCli(projectDir, ["init"]);
    writeScript(projectDir, "collect-first.mjs", 'console.log(JSON.stringify({ id: "bitcoin" }));\n');
    writeScript(projectDir, "collect-second.mjs", 'console.log(JSON.stringify({ id: "ethereum" }));\n');
    writeSchedules(
      projectDir,
      [
        "  collect_first:",
        "    entity: coins_list",
        "    command: node ./collect-first.mjs",
        "    schedule:",
        "      type: cron",
        "      expression: \"5 0 * * *\"",
        "  collect_second:",
        "    entity: coins_list",
        "    command: node ./collect-second.mjs",
        "    schedule:",
        "      type: cron",
        "      expression: \"5 0 * * *\"",
      ].join("\n"),
    );

    const events = parseEvents(
      await runSchedulerStart(projectDir, {
        once: true,
        now: new Date("2026-07-06T00:05:30.000Z"),
      }),
    );

    expect(events).toEqual([
      {
        event: "scheduler_started",
        timestamp: expect.any(String),
      },
      {
        event: "tick_started",
        timestamp: expect.any(String),
      },
      {
        event: "job_due",
        timestamp: expect.any(String),
        jobId: "collect_first",
        database: "local",
      },
      {
        event: "job_succeeded",
        timestamp: expect.any(String),
        jobId: "collect_first",
        database: "local",
        jobRunId: expect.any(String),
        recordsWritten: 1,
      },
      {
        event: "job_due",
        timestamp: expect.any(String),
        jobId: "collect_second",
        database: "local",
      },
      {
        event: "job_succeeded",
        timestamp: expect.any(String),
        jobId: "collect_second",
        database: "local",
        jobRunId: expect.any(String),
        recordsWritten: 1,
      },
      {
        event: "tick_finished",
        timestamp: expect.any(String),
      },
    ]);
    expect(readRecords(projectDir)).toEqual([
      {
        id: 'scheduler-same-db:coins_list:["bitcoin"]',
        source: "collect_first",
      },
      {
        id: 'scheduler-same-db:coins_list:["ethereum"]',
        source: "collect_second",
      },
    ]);
    expect(readJobRuns(projectDir)).toEqual([
      {
        job_id: "collect_first",
        status: "succeeded",
        records_written: 1,
        error_message: null,
      },
      {
        job_id: "collect_second",
        status: "succeeded",
        records_written: 1,
        error_message: null,
      },
    ]);
  });

  it("skips only jobs in a blocked non-default database", async () => {
    const projectDir = makeTempProject("scheduler-research-locked");
    runCli(projectDir, ["init"]);
    writeMultiDatabaseProjectConfig(projectDir);
    runCli(projectDir, ["db", "init"]);
    writeScript(projectDir, "collect-local.mjs", 'console.log(JSON.stringify({ id: "bitcoin" }));\n');
    writeScript(projectDir, "collect-research.mjs", 'console.log(JSON.stringify({ id: "ethereum" }));\n');
    writeSchedules(
      projectDir,
      [
        "  collect_local:",
        "    entity: coins_list",
        "    command: node ./collect-local.mjs",
        "    schedule:",
        "      type: cron",
        "      expression: \"5 0 * * *\"",
        "  collect_research:",
        "    database: research",
        "    entity: coins_list",
        "    command: node ./collect-research.mjs",
        "    schedule:",
        "      type: cron",
        "      expression: \"5 0 * * *\"",
      ].join("\n"),
    );
    insertRunningJob(projectDir, "other_job", "research");

    const events = parseEvents(
      await runSchedulerStart(projectDir, {
        once: true,
        now: new Date("2026-07-06T00:05:30.000Z"),
      }),
    );

    expect(events).toEqual(
      expect.arrayContaining([
        {
          event: "job_due",
          timestamp: expect.any(String),
          jobId: "collect_local",
          database: "local",
        },
        {
          event: "job_succeeded",
          timestamp: expect.any(String),
          jobId: "collect_local",
          database: "local",
          jobRunId: expect.any(String),
          recordsWritten: 1,
        },
        {
          event: "job_due",
          timestamp: expect.any(String),
          jobId: "collect_research",
          database: "research",
        },
        {
          event: "job_skipped",
          timestamp: expect.any(String),
          jobId: "collect_research",
          database: "research",
          errorMessage: "scheduler skipped job because another job is already running in this database",
        },
      ]),
    );
    expect(readRecords(projectDir)).toEqual([
      {
        id: 'scheduler-research-locked:coins_list:["bitcoin"]',
        source: "collect_local",
      },
    ]);
    expect(readRecords(projectDir, "research")).toEqual([]);
  });
});
