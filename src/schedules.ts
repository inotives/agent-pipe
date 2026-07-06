import fs from "node:fs";

import { CronExpressionParser } from "cron-parser";
import { parse } from "yaml";
import { z } from "zod";

const entityConfigSchema = z.object({
  idFields: z.array(z.string().min(1)).min(1),
});

const manualScheduleSchema = z
  .object({
    type: z.literal("manual"),
  })
  .strict();

const cronScheduleSchema = z
  .object({
    type: z.literal("cron"),
    expression: z.string().min(1),
  })
  .strict()
  .superRefine((value, context) => {
    try {
      CronExpressionParser.parse(value.expression);
    } catch {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "invalid cron expression",
        path: ["expression"],
      });
    }
  });

const scheduleConfigSchema = z.discriminatedUnion("type", [manualScheduleSchema, cronScheduleSchema]);

const jobConfigSchema = z
  .object({
  entity: z.string().min(1),
  command: z.string().min(1),
  timeoutMs: z.number().int().positive().optional(),
    schedule: scheduleConfigSchema.optional(),
  })
  .transform((job) => ({
    ...job,
    schedule: job.schedule ?? { type: "manual" as const },
  }));

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

  const jobs = z.record(z.string(), z.unknown()).parse(value ?? {});
  return Object.fromEntries(
    Object.entries(jobs).map(([jobId, job]) => {
      try {
        return [jobId, jobConfigSchema.parse(job)];
      } catch (error) {
        if (error instanceof z.ZodError) {
          const issue = error.issues[0];
          if (issue?.path.join(".") === "schedule.expression" && issue.message === "invalid cron expression") {
            throw new Error(`invalid job "${jobId}": invalid cron expression`);
          }
        }
        throw new Error(`invalid job "${jobId}"`);
      }
    }),
  );
}
