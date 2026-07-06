import { CronExpressionParser } from "cron-parser";
import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import { runJob } from "./job-run.js";
import { findProjectRoot } from "./project.js";
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
  recordsWritten?: number;
  errorMessage?: string;
};

export async function runSchedulerStart(cwd: string, options: SchedulerStartOptions): Promise<string> {
  const projectRoot = findProjectRoot(cwd);
  if (!projectRoot) {
    throw new Error("missing .agent-pipe project; run `agent-pipe init` first");
  }

  const schedulesPath = path.join(projectRoot, ".agent-pipe", "schedules.yaml");
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
    await runSchedulerTick({ cwd, projectRoot, schedules, now: nowProvider(), events });
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
  schedules: ReturnType<typeof loadSchedulesConfig>;
  now: Date;
  events: SchedulerEvent[];
}): Promise<void> {
  pushEvent(input.events, "tick_started", input.now);

  for (const [jobId, job] of Object.entries(input.schedules.jobs)) {
    if (job.schedule.type !== "cron" || !isDueThisMinute(job.schedule.expression, input.now)) {
      continue;
    }

    pushEvent(input.events, "job_due", input.now, { jobId });
    if (hasAnyRunningJob(input.projectRoot)) {
      pushEvent(input.events, "job_skipped", new Date(), {
        jobId,
        errorMessage: "scheduler skipped job because another job is already running",
      });
      pushEvent(input.events, "tick_finished", new Date());
      return;
    }

    try {
      const result = await runJob(input.cwd, { jobId });
      pushEvent(input.events, "job_succeeded", new Date(), {
        jobId,
        jobRunId: result.jobRunId,
        recordsWritten: result.recordsWritten,
      });
    } catch (error) {
      pushEvent(input.events, "job_failed", new Date(), {
        jobId,
        errorMessage: error instanceof Error ? error.message : "scheduler job failed",
      });
    }
    pushEvent(input.events, "tick_finished", new Date());
    return;
  }

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

function hasAnyRunningJob(projectRoot: string): boolean {
  const databasePath = path.join(projectRoot, ".agent-pipe", "data", "local.sqlite");
  if (!fs.existsSync(databasePath)) {
    throw new Error("missing .agent-pipe/data/local.sqlite; run `agent-pipe init` first");
  }

  const database = new Database(databasePath, { readonly: true });
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
