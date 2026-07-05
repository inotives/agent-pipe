import { Command } from "commander";
import { z } from "zod";

import { runJob } from "./job-run.js";
import { runJobsList } from "./jobs-list.js";
import { runInit } from "./init.js";
import { validateProjectId } from "./project.js";
import { runPut } from "./put.js";
import { runRecordsList, runRecordsShow } from "./records-query.js";
import { runRunsList, runRunsShow } from "./runs-query.js";
import { runSourceList } from "./source-list.js";
import { runSource } from "./source-run.js";

const putOptionsSchema = z.object({
  entity: z.string().regex(/^[a-z0-9_-]+$/, {
    message: "entity must match ^[a-z0-9_-]+$",
  }),
  file: z.string().min(1, "file is required"),
});

type StubPayload = Record<string, unknown>;

function writeStub(payload: StubPayload): void {
  process.stdout.write(`${JSON.stringify({ status: "stub", ...payload })}\n`);
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

export function buildCli(): Command {
  const program = new Command();

  program
    .name("agent-pipe")
    .description("Deterministic local ingestion CLI")
    .showHelpAfterError()
    .configureOutput({
      outputError: (message, write) => write(message),
    });

  program
    .command("init")
    .description("Initialize project state")
    .option("--project-id <projectId>", "override the derived project id")
    .option("--project-name <projectName>", "override the derived project name")
    .action(async (options: { projectId?: string; projectName?: string }) => {
      const parsedProjectId = z.string().optional().safeParse(options.projectId);
      if (!parsedProjectId.success) {
        fail(parsedProjectId.error.issues[0]?.message ?? "invalid project id");
      }
      if (options.projectId) {
        try {
          validateProjectId(options.projectId);
        } catch (error) {
          if (error instanceof z.ZodError) {
            fail(error.issues[0]?.message ?? "invalid project id");
          }
          throw error;
        }
      }

      try {
        const result = runInit(process.cwd(), options);
        process.stdout.write(`${JSON.stringify(result)}\n`);
      } catch (error) {
        fail(error instanceof Error ? error.message : "init failed");
      }
    });

  program
    .command("put")
    .description("Ingest one JSON payload file into an entity")
    .requiredOption("--entity <entity>", "entity name")
    .requiredOption("--file <file>", "JSON file path")
    .action((options: { entity: string; file: string }) => {
      const parsed = putOptionsSchema.safeParse(options);
      if (!parsed.success) {
        fail(parsed.error.issues[0]?.message ?? "invalid put options");
      }

      try {
        const result = runPut(process.cwd(), parsed.data);
        process.stdout.write(`${JSON.stringify(result)}\n`);
      } catch (error) {
        fail(error instanceof Error ? error.message : "put failed");
      }
    });

  const source = program.command("source").description("Inspect configured sources");

  source
    .command("list")
    .description("List configured sources")
    .option("--json", "print JSON for automation")
    .action((options: { json?: boolean }) => {
      try {
        const output = runSourceList(process.cwd(), options);
        process.stdout.write(`${output}\n`);
      } catch (error) {
        fail(error instanceof Error ? error.message : "source list failed");
      }
    });

  source
    .command("run")
    .description("Run one configured source")
    .argument("<sourceId>", "configured source id")
    .action(async (sourceId: string) => {
      try {
        const result = await runSource(process.cwd(), { sourceId });
        process.stdout.write(`${JSON.stringify(result)}\n`);
      } catch (error) {
        fail(error instanceof Error ? error.message : "source run failed");
      }
    });

  const jobs = program.command("jobs").description("Inspect configured jobs");

  jobs
    .command("list")
    .description("List configured jobs")
    .option("--json", "print JSON for automation")
    .action((options: { json?: boolean }) => {
      try {
        const output = runJobsList(process.cwd(), options);
        process.stdout.write(`${output}\n`);
      } catch (error) {
        fail(error instanceof Error ? error.message : "jobs list failed");
      }
    });

  program
    .command("run")
    .description("Run one configured job")
    .requiredOption("--job <jobId>", "configured job id")
    .action(async (options: { job: string }) => {
      try {
        const result = await runJob(process.cwd(), { jobId: options.job });
        process.stdout.write(`${JSON.stringify(result)}\n`);
      } catch (error) {
        fail(error instanceof Error ? error.message : "job run failed");
      }
    });

  const records = program.command("records").description("Inspect stored records");

  records
    .command("list")
    .description("List stored records")
    .option("--entity <entity>", "filter by entity")
    .option("--source <source>", "filter by source")
    .option("--limit <limit>", "maximum rows to return")
    .option("--include-deleted", "include soft-deleted rows")
    .option("--json", "print JSON for automation")
    .action((options: { entity?: string; source?: string; limit?: string; includeDeleted?: boolean; json?: boolean }) => {
      try {
        const output = runRecordsList(process.cwd(), options);
        process.stdout.write(`${output}\n`);
      } catch (error) {
        fail(error instanceof Error ? error.message : "records list failed");
      }
    });

  records
    .command("show")
    .description("Show one stored record")
    .argument("<id>", "stored record id")
    .action((id: string) => {
      try {
        const output = runRecordsShow(process.cwd(), id);
        process.stdout.write(`${output}\n`);
      } catch (error) {
        fail(error instanceof Error ? error.message : "records show failed");
      }
    });

  const runs = program.command("runs").description("Inspect stored run history");

  runs
    .command("list")
    .description("List stored runs")
    .option("--status <status>", "filter by status")
    .option("--job-id <jobId>", "filter by job id")
    .option("--limit <limit>", "maximum rows to return")
    .option("--json", "print JSON for automation")
    .action((options: { status?: string; jobId?: string; limit?: string; json?: boolean }) => {
      try {
        const output = runRunsList(process.cwd(), options);
        process.stdout.write(`${output}\n`);
      } catch (error) {
        fail(error instanceof Error ? error.message : "runs list failed");
      }
    });

  runs
    .command("show")
    .description("Show one stored run")
    .argument("<id>", "stored run id")
    .action((id: string) => {
      try {
        const output = runRunsShow(process.cwd(), id);
        process.stdout.write(`${output}\n`);
      } catch (error) {
        fail(error instanceof Error ? error.message : "runs show failed");
      }
    });

  return program;
}
