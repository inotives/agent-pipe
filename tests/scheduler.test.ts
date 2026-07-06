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

function readRecords(projectDir: string): Array<Record<string, unknown>> {
  const database = new Database(path.join(projectDir, ".agent-pipe/data/local.sqlite"), { readonly: true });
  try {
    return database.prepare("select id, source from records order by id").all() as Array<Record<string, unknown>>;
  } finally {
    database.close();
  }
}

function readJobRuns(projectDir: string): Array<Record<string, unknown>> {
  const database = new Database(path.join(projectDir, ".agent-pipe/data/local.sqlite"), { readonly: true });
  try {
    return database
      .prepare("select job_id, status, records_written, error_message from job_runs order by started_at, id")
      .all() as Array<Record<string, unknown>>;
  } finally {
    database.close();
  }
}

function insertRunningJob(projectDir: string, jobId: string): void {
  const database = new Database(path.join(projectDir, ".agent-pipe/data/local.sqlite"));
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

    const events = output.trim().split("\n").map((line) => JSON.parse(line));
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
      },
      {
        event: "job_succeeded",
        timestamp: expect.any(String),
        jobId: "collect_prices",
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

    expect(output.trim().split("\n").map((line) => JSON.parse(line).event)).toEqual([
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

    expect(output.trim().split("\n").map((line) => JSON.parse(line).event)).toEqual([
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
    expect(output.trim().split("\n").map((line) => JSON.parse(line).event)).toEqual([
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

  it("emits job_skipped when another job is already running", async () => {
    const projectDir = makeTempProject("scheduler-locked");
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
    insertRunningJob(projectDir, "other_job");

    const output = await runSchedulerStart(projectDir, {
      once: true,
      now: new Date("2026-07-06T00:05:30.000Z"),
    });

    expect(output.trim().split("\n").map((line) => JSON.parse(line))).toEqual([
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
      },
      {
        event: "job_skipped",
        timestamp: expect.any(String),
        jobId: "collect_prices",
        errorMessage: "scheduler skipped job because another job is already running",
      },
      {
        event: "tick_finished",
        timestamp: expect.any(String),
      },
    ]);
    expect(readRecords(projectDir)).toEqual([]);
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

    expect(output.trim().split("\n").map((line) => JSON.parse(line))).toEqual([
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
      },
      {
        event: "job_failed",
        timestamp: expect.any(String),
        jobId: "collect_prices",
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
});
