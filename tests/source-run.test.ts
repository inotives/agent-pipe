import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];
const repoRoot = path.resolve(__dirname, "..");
const tsxLoader = path.join(repoRoot, "node_modules/tsx/dist/loader.mjs");
const cliEntry = path.join(repoRoot, "src/index.ts");
const execFileAsync = promisify(execFile);

function makeTempProject(name: string): string {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "agent-pipe-source-run-"));
  const dir = path.join(parent, name);
  fs.mkdirSync(dir, { recursive: true });
  tempDirs.push(parent);
  return dir;
}

async function runCli(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      ["--import", tsxLoader, cliEntry, ...args],
      { cwd, encoding: "utf8" },
    );
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

async function withServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
  run: (baseUrl: string) => Promise<void> | void,
): Promise<boolean> {
  const server = createServer(handler);
  try {
    await new Promise<void>((resolve, reject) =>
      server.listen(0, "127.0.0.1", () => resolve()).once("error", reject),
    );
  } catch (error) {
    server.close();
    if ((error as NodeJS.ErrnoException).code === "EPERM") {
      return false;
    }
    throw error;
  }
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to start test server");
  }
  try {
    await run(`http://127.0.0.1:${address.port}`);
    return true;
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

function writeSources(projectDir: string, content: string): void {
  fs.writeFileSync(path.join(projectDir, ".agent-pipe", "sources.yaml"), content, "utf8");
}

function readRecords(projectDir: string): Array<Record<string, unknown>> {
  const database = new Database(path.join(projectDir, ".agent-pipe/data/local.sqlite"), { readonly: true });
  try {
    return database
      .prepare("select id, entity, source, payload_json, metadata_json from records order by id")
      .all() as Array<Record<string, unknown>>;
  } finally {
    database.close();
  }
}

function readJobRuns(projectDir: string): Array<Record<string, unknown>> {
  const database = new Database(path.join(projectDir, ".agent-pipe/data/local.sqlite"), { readonly: true });
  try {
    return database
      .prepare(
        "select id, job_id, entity, status, started_at, finished_at, records_written, error_message, metadata_json from job_runs order by started_at, id",
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

describe("agent-pipe source run", () => {
  it("runs a selected API source and ignores unrelated invalid sibling sources", async () => {
    const ran = await withServer((req, res) => {
      if (req.url?.startsWith("/api/v3/coins/list")) {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify([{ id: "bitcoin" }, { id: "ethereum" }]));
        return;
      }
      res.statusCode = 404;
      res.end();
    }, async (baseUrl) => {
      const projectDir = makeTempProject("source-run-list");
      await runCli(projectDir, ["init"]);
      writeSources(
        projectDir,
        `sources:
  smoke_source:
    entity: coins_list
    type: api
    idFields:
      - id
    api:
      baseUrl: ${baseUrl}/api/v3
      endpoint: /coins/list
      method: GET
      payloadPath: $
      pagination:
        type: none
  broken_other:
    entity: ignored
    type: graphql
`,
      );

      const result = await runCli(projectDir, ["source", "run", "smoke_source"]);
      expect(result.stderr).toBe("");
      const output = JSON.parse(result.stdout) as {
        sourceId: string;
        entity: string;
        recordsWritten: number;
        jobRunId: string;
      };
      expect(output).toEqual({
        sourceId: "smoke_source",
        entity: "coins_list",
        recordsWritten: 2,
        jobRunId: output.jobRunId,
      });
      const records = readRecords(projectDir);
      expect(records).toHaveLength(2);
      expect(records.map((row) => row.source)).toEqual(["smoke_source", "smoke_source"]);
      expect(
        records.every((row) => {
          const metadata = JSON.parse(String(row.metadata_json)) as Record<string, unknown>;
          return metadata.url && metadata.statusCode === 200 && metadata.fetchedAt && metadata.ingestionType === "api";
        }),
      ).toBe(true);
      expect(readJobRuns(projectDir)).toEqual([
        {
          id: output.jobRunId,
          job_id: "smoke_source",
          entity: "coins_list",
          status: "succeeded",
          started_at: expect.any(String),
          finished_at: expect.any(String),
          records_written: 2,
          error_message: null,
          metadata_json: JSON.stringify({ sourceId: "smoke_source" }),
        },
      ]);
    });
    if (!ran) {
      return;
    }
  });

  it("supports page pagination and minDelayMs between requests", async () => {
    const seenAt: number[] = [];
    const ran = await withServer((req, res) => {
      seenAt.push(Date.now());
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const page = url.searchParams.get("page");
      expect(url.searchParams.get("per_page")).toBe("1");
      res.setHeader("content-type", "application/json");
      if (page === "1") {
        res.end(JSON.stringify([{ id: "btc" }]));
        return;
      }
      res.end(JSON.stringify([]));
    }, async (baseUrl) => {
      const projectDir = makeTempProject("source-run-page");
      await runCli(projectDir, ["init"]);
      writeSources(
        projectDir,
        `sources:
  page_source:
    entity: coins_markets
    type: api
    idFields:
      - id
    api:
      baseUrl: ${baseUrl}
      endpoint: /coins/markets
      method: GET
      query:
        per_page: 1
      payloadPath: $
      pagination:
        type: page
        pageParam: page
        perPageParam: per_page
        startPage: 1
        maxPages: 3
        stopWhen: empty_page
      rateLimit:
        minDelayMs: 20
`,
      );

      const result = await runCli(projectDir, ["source", "run", "page_source"]);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout).recordsWritten).toBe(1);
    });
    if (!ran) {
      return;
    }

    expect(seenAt).toHaveLength(2);
    expect(seenAt[1] - seenAt[0]).toBeGreaterThanOrEqual(15);
  });

  it("supports path params and query params, including id fallbacks from config", async () => {
    const ran = await withServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      expect(url.pathname).toBe("/coins/bitcoin/history");
      expect(url.searchParams.get("date")).toBe("30-12-2025");
      expect(url.searchParams.get("localization")).toBe("false");
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ price: 1 }));
    }, async (baseUrl) => {
      const projectDir = makeTempProject("source-run-history");
      await runCli(projectDir, ["init"]);
      writeSources(
        projectDir,
        `sources:
  history_source:
    entity: coin_history
    type: api
    idFields:
      - id
      - date
    api:
      baseUrl: ${baseUrl}
      endpoint: /coins/{id}/history
      method: GET
      params:
        id: bitcoin
      query:
        date: 30-12-2025
        localization: false
      payloadPath: $
      pagination:
        type: none
`,
      );

      const result = await runCli(projectDir, ["source", "run", "history_source"]);
      expect(result.stderr).toBe("");
      const output = JSON.parse(result.stdout) as {
        sourceId: string;
        entity: string;
        recordsWritten: number;
        jobRunId: string;
      };
      expect(output).toEqual({
        sourceId: "history_source",
        entity: "coin_history",
        recordsWritten: 1,
        jobRunId: output.jobRunId,
      });
      const records = readRecords(projectDir);
      expect(records[0]?.id).toBe('source-run-history:coin_history:["bitcoin","30-12-2025"]');
    });
    if (!ran) {
      return;
    }
  });

  it("keeps earlier paginated records and marks the job failed when a later page fails", async () => {
    const ran = await withServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const page = url.searchParams.get("page");
      if (page === "1") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify([{ id: "btc" }]));
        return;
      }
      res.statusCode = 500;
      res.end("boom");
    }, async (baseUrl) => {
      const projectDir = makeTempProject("source-run-page-failure");
      await runCli(projectDir, ["init"]);
      writeSources(
        projectDir,
        `sources:
  flaky_page_source:
    entity: coins_markets
    type: api
    idFields:
      - id
    api:
      baseUrl: ${baseUrl}
      endpoint: /coins/markets
      method: GET
      query:
        per_page: 1
      payloadPath: $
      pagination:
        type: page
        pageParam: page
        perPageParam: per_page
        startPage: 1
        maxPages: 3
        stopWhen: empty_page
`,
      );

      const result = await runCli(projectDir, ["source", "run", "flaky_page_source"]);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("request failed with status 500");

      const records = readRecords(projectDir);
      expect(records).toHaveLength(1);
      expect(records[0]?.id).toBe('source-run-page-failure:coins_markets:["btc"]');

      expect(readJobRuns(projectDir)).toEqual([
        {
          id: expect.any(String),
          job_id: "flaky_page_source",
          entity: "coins_markets",
          status: "failed",
          started_at: expect.any(String),
          finished_at: expect.any(String),
          records_written: 1,
          error_message: expect.stringContaining("request failed with status 500"),
          metadata_json: JSON.stringify({ sourceId: "flaky_page_source" }),
        },
      ]);
    });
    if (!ran) {
      return;
    }
  });

  it("fails clearly for unsupported source shapes", async () => {
    const projectDir = makeTempProject("source-run-unsupported");
    await runCli(projectDir, ["init"]);
    const cases = [
      {
        sourceId: "bad_type",
        yaml: `sources:
  bad_type:
    entity: coins
    type: file
    idFields: [id]
`,
        expected: /unsupported source type "file"/,
      },
      {
        sourceId: "bad_method",
        yaml: `sources:
  bad_method:
    entity: coins
    type: api
    idFields: [id]
    api:
      baseUrl: http://example.test
      endpoint: /coins
      method: POST
      payloadPath: $
      pagination:
        type: none
`,
        expected: /unsupported method "POST"/,
      },
      {
        sourceId: "bad_payload",
        yaml: `sources:
  bad_payload:
    entity: coins
    type: api
    idFields: [id]
    api:
      baseUrl: http://example.test
      endpoint: /coins
      method: GET
      payloadPath: $.items
      pagination:
        type: none
`,
        expected: /unsupported payloadPath "\$\.items"/,
      },
      {
        sourceId: "bad_pagination",
        yaml: `sources:
  bad_pagination:
    entity: coins
    type: api
    idFields: [id]
    api:
      baseUrl: http://example.test
      endpoint: /coins
      method: GET
      payloadPath: $
      pagination:
        type: cursor
`,
        expected: /unsupported pagination type "cursor"/,
      },
      {
        sourceId: "bad_requests_per_minute",
        yaml: `sources:
  bad_requests_per_minute:
    entity: coins
    type: api
    idFields: [id]
    api:
      baseUrl: http://example.test
      endpoint: /coins
      method: GET
      payloadPath: $
      pagination:
        type: none
      rateLimit:
        requestsPerMinute: 5
`,
        expected: /unsupported requestsPerMinute/,
      },
    ];

    for (const testCase of cases) {
      writeSources(projectDir, testCase.yaml);
      const result = await runCli(projectDir, ["source", "run", testCase.sourceId]);
      expect(result.stderr).toMatch(testCase.expected);
    }
  });

  it("fails clearly when an env placeholder is missing", async () => {
    const projectDir = makeTempProject("source-run-missing-env");
    await runCli(projectDir, ["init"]);
    writeSources(
      projectDir,
      `sources:
  needs_env:
    entity: coins_list
    type: api
    idFields: [id]
    api:
      baseUrl: http://example.test
      endpoint: /coins
      method: GET
      query:
        api_key: \${AGENT_PIPE_TEST_MISSING_PLACEHOLDER}
      payloadPath: $
      pagination:
        type: none
`,
    );

    const result = await runCli(projectDir, ["source", "run", "needs_env"]);
    expect(result.stderr).toContain(
      'missing env placeholder "AGENT_PIPE_TEST_MISSING_PLACEHOLDER" for source "needs_env"',
    );
  });
});
