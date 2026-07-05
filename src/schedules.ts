import fs from "node:fs";

import { parse } from "yaml";
import { z } from "zod";

const entityConfigSchema = z.object({
  idFields: z.array(z.string().min(1)).min(1),
});

const jobConfigSchema = z.object({
  entity: z.string().min(1),
  command: z.string().min(1),
  timeoutMs: z.number().int().positive().optional(),
});

export type JobConfig = z.infer<typeof jobConfigSchema>;

export type SchedulesConfig = {
  entities: Record<string, z.infer<typeof entityConfigSchema>>;
  jobs: Record<string, JobConfig>;
};

export function loadSchedulesConfig(schedulesPath: string): SchedulesConfig {
  try {
    const parsed = parse(fs.readFileSync(schedulesPath, "utf8")) as {
      entities?: unknown;
      jobs?: unknown;
    };
    const entities = z.record(z.string(), entityConfigSchema).parse(parsed?.entities);
    const jobs = parseJobs(parsed?.jobs);

    for (const [jobId, job] of Object.entries(jobs)) {
      if (!entities[job.entity]) {
        throw new Error(`invalid job "${jobId}": unknown entity "${job.entity}"`);
      }
    }

    return { entities, jobs };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("invalid job ")) {
      throw error;
    }
    if (error instanceof z.ZodError) {
      const path = error.issues[0]?.path ?? [];
      const jobId =
        path[0] === "jobs" && typeof path[1] === "string"
          ? path[1]
          : typeof path[0] === "string"
            ? path[0]
            : null;
      if (jobId) {
        throw new Error(`invalid job "${jobId}"`);
      }
    }
    throw new Error("invalid .agent-pipe/schedules.yaml");
  }
}

function parseJobs(value: unknown): Record<string, JobConfig> {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return {};
    }
    throw new Error("invalid .agent-pipe/schedules.yaml");
  }

  return z.record(z.string(), jobConfigSchema).parse(value ?? {});
}
