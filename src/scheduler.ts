import { CronExpressionParser } from "cron-parser";
import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import { runJob } from "./job-run.js";
import { findProjectRoot } from "./project.js";
import { bootstrapProjectDatabase, resolveProjectDatabase, type ResolvedProjectDatabase } from "./runtime.js";
import { loadSchedulesConfig } from "./schedules.js";

type SchedulerStartOptions = {
  once?: boolean;
  pollIntervalMs?: number;
  maxTicks?: number;
  now?: Date;
  nowProvider?: () => Date;
  sleep?: (ms: number) => Promise<void>;
};

type SchedulerEvent = {
  event: string;
  timestamp: string;
  jobId?: string;
  jobRunId?: string;
  database?: string;
  recordsWritten?: number;
  errorMessage?: string;
};

export async function runSchedulerStart(cwd: string, options: SchedulerStartOptions): Promise<string> {
  const projectRoot = findProjectRoot(cwd);
  if (!projectRoot) {
    throw new Error("missing .agent-pipe project; run `agent-pipe init` first");
  }

  const schedulesPath = path.join(projectRoot, ".agent-pipe", "schedules.yaml");
  const projectConfigPath = path.join(projectRoot, ".agent-pipe", "project.yaml");
  if (!fs.existsSync(projectConfigPath)) {
    throw new Error("missing .agent-pipe/project.yaml; run `agent-pipe init` first");
  }
  if (!fs.existsSync(schedulesPath)) {
    throw new Error("missing .agent-pipe/schedules.yaml; run `agent-pipe init` first");
  }

  const schedules = loadSchedulesConfig(schedulesPath);
  const events: SchedulerEvent[] = [];
  const pollIntervalMs = parsePollIntervalMs(options.pollIntervalMs);
  const sleep = options.sleep ?? defaultSleep;
  const nowProvider = options.nowProvider ?? (() => options.now ?? new Date());
  const maxTicks = options.once ? 1 : options.maxTicks;
  pushEvent(events, "scheduler_started", nowProvider());

  for (let tick = 0; maxTicks === undefined || tick < maxTicks; tick += 1) {
    await runSchedulerTick({ cwd, projectRoot, projectConfigPath, schedules, now: nowProvider(), events });
    if (options.once || (maxTicks !== undefined && tick + 1 >= maxTicks)) {
      break;
    }
    await sleep(pollIntervalMs);
  }

  return events.map((event) => JSON.stringify(event)).join("\n");
}

async function runSchedulerTick(input: {
  cwd: string;
  projectRoot: string;
  projectConfigPath: string;
  schedules: ReturnType<typeof loadSchedulesConfig>;
  now: Date;
  events: SchedulerEvent[];
}): Promise<void> {
  pushEvent(input.events, "tick_started", input.now);

  const dueJobsByDatabase = new Map<string, Array<{ jobId: string; database: ResolvedProjectDatabase }>>();

  for (const [jobId, job] of Object.entries(input.schedules.jobs)) {
    if (job.schedule.type !== "cron" || !isDueThisMinute(job.schedule.expression, input.now)) {
      continue;
    }

    const database = resolveProjectDatabase(input.projectConfigPath, job.database);
    const jobs = dueJobsByDatabase.get(database.name);
    if (jobs) {
      jobs.push({ jobId, database });
    } else {
      dueJobsByDatabase.set(database.name, [{ jobId, database }]);
    }
  }

  await Promise.all(
    Array.from(dueJobsByDatabase.values(), (jobs) => runSchedulerDatabaseGroup(input.cwd, input.events, input.now, jobs)),
  );

  pushEvent(input.events, "tick_finished", new Date());
}

function pushEvent(
  events: SchedulerEvent[],
  event: SchedulerEvent["event"],
  timestamp: Date,
  extra: Omit<SchedulerEvent, "event" | "timestamp"> = {},
): void {
  events.push({
    event,
    timestamp: timestamp.toISOString(),
    ...extra,
  });
}

function isDueThisMinute(expression: string, now: Date): boolean {
  const minuteStart = new Date(now);
  minuteStart.setUTCSeconds(0, 0);

  const previousInstant = new Date(minuteStart.getTime() - 1);
  const next = CronExpressionParser.parse(expression, {
    currentDate: previousInstant,
    tz: "UTC",
  }).next();

  return next.toISOString() === minuteStart.toISOString();
}

function parsePollIntervalMs(value: number | undefined): number {
  if (value === undefined) {
    return 60000;
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("poll interval must be a positive integer");
  }
  return value;
}

async function runSchedulerDatabaseGroup(
  cwd: string,
  events: SchedulerEvent[],
  dueAt: Date,
  jobs: Array<{ jobId: string; database: ResolvedProjectDatabase }>,
): Promise<void> {
  for (const job of jobs) {
    pushEvent(events, "job_due", dueAt, { jobId: job.jobId, database: job.database.name });
    if (hasRunningJobInDatabase(job.database)) {
      pushEvent(events, "job_skipped", new Date(), {
        jobId: job.jobId,
        database: job.database.name,
        errorMessage: "scheduler skipped job because another job is already running in this database",
      });
      continue;
    }

    try {
      const result = await runJob(cwd, { jobId: job.jobId });
      pushEvent(events, "job_succeeded", new Date(), {
        jobId: job.jobId,
        database: job.database.name,
        jobRunId: result.jobRunId,
        recordsWritten: result.recordsWritten,
      });
    } catch (error) {
      pushEvent(events, "job_failed", new Date(), {
        jobId: job.jobId,
        database: job.database.name,
        errorMessage: error instanceof Error ? error.message : "scheduler job failed",
      });
    }
  }
}

function hasRunningJobInDatabase(databaseConfig: ResolvedProjectDatabase): boolean {
  bootstrapProjectDatabase(databaseConfig.absolutePath);

  const database = new Database(databaseConfig.absolutePath, { readonly: true });
  try {
    const row = database.prepare("select 1 from job_runs where status = 'running' limit 1").get() as
      | { 1: number }
      | undefined;
    return Boolean(row);
  } finally {
    database.close();
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
