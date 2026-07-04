import { Command } from "commander";
import { z } from "zod";

import { runInit } from "./init.js";
import { validateProjectId } from "./project.js";
import { runPut } from "./put.js";

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

  return program;
}
