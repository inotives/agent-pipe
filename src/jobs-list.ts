import fs from "node:fs";
import path from "node:path";

import { findProjectRoot } from "./project.js";
import { loadSchedulesConfig } from "./schedules.js";

type JobsListOptions = {
  json?: boolean;
};

type JobSummary = {
  jobId: string;
  entity: string;
  command: string;
};

export function runJobsList(cwd: string, options: JobsListOptions): string {
  const projectRoot = findProjectRoot(cwd);
  if (!projectRoot) {
    throw new Error("missing .agent-pipe project; run `agent-pipe init` first");
  }

  const schedulesPath = path.join(projectRoot, ".agent-pipe", "schedules.yaml");
  if (!fs.existsSync(schedulesPath)) {
    throw new Error("missing .agent-pipe/schedules.yaml; run `agent-pipe init` first");
  }

  const jobs = loadJobSummaries(schedulesPath);
  if (options.json) {
    return JSON.stringify(jobs);
  }
  return formatJobsTable(jobs);
}

function loadJobSummaries(schedulesPath: string): JobSummary[] {
  const { jobs } = loadSchedulesConfig(schedulesPath);
  return Object.entries(jobs).map(([jobId, job]) => ({
    jobId,
    entity: job.entity,
    command: job.command,
  }));
}

function formatJobsTable(jobs: JobSummary[]): string {
  const headers = ["JOB_ID", "ENTITY", "COMMAND"] as const;
  const rows = jobs.map((job) => [job.jobId, job.entity, job.command]);
  const widths = headers.map((header, index) => Math.max(header.length, ...rows.map((row) => row[index].length)));
  const formatRow = (row: readonly string[]) =>
    row.map((value, index) => value.padEnd(widths[index])).join("  ").trimEnd();

  return `${formatRow(headers)}\n${rows.map((row) => formatRow(row)).join("\n")}`;
}
