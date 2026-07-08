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
const sampleCsvPath = path.join(repoRoot, "data/csv/DFF.csv");
const sampleJsonPath = path.join(repoRoot, "data/json/tracked-tickers.json");
const sampleMarkdownPath = path.join(
  repoRoot,
  "data/markdown/2026-07-06__agent-memory-tools-context-mode-codegraph.md",
);
const sampleCsvRowCount = fs.readFileSync(sampleCsvPath, "utf8").trim().split("\n").length - 1;
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

function writeProjectYaml(projectDir: string, lines: string[]): void {
  fs.writeFileSync(path.join(projectDir, ".agent-pipe/project.yaml"), `${lines.join("\n")}\n`, "utf8");
}

function writeProjectFile(projectDir: string, relativePath: string, content: string): void {
  const targetPath = path.join(projectDir, relativePath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content, "utf8");
}

function copyProjectFile(projectDir: string, fromPath: string, toRelativePath: string): void {
  const targetPath = path.join(projectDir, toRelativePath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(fromPath, targetPath);
}

function readRecords(projectDir: string, databaseName = "local"): Array<Record<string, unknown>> {
  const database = new Database(path.join(projectDir, `.agent-pipe/data/${databaseName}.sqlite`), { readonly: true });
  try {
    return database
      .prepare("select id, entity, source, payload_json, metadata_json from records order by id")
      .all() as Array<Record<string, unknown>>;
  } finally {
    database.close();
  }
}

function readJobRuns(projectDir: string, databaseName = "local"): Array<Record<string, unknown>> {
  const database = new Database(path.join(projectDir, `.agent-pipe/data/${databaseName}.sqlite`), { readonly: true });
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

  it("validates selected file source config without blocking on unrelated invalid siblings", async () => {
    const projectDir = makeTempProject("source-run-file-config");
    await runCli(projectDir, ["init"]);
    const cases = [
      {
        sourceId: "file_missing_config",
        yaml: `sources:
  file_missing_config:
    entity: coins
    type: file
    idFields: [id]
  broken_other:
    entity: ignored
    type: api
`,
        expected: 'invalid source "file_missing_config": missing file config',
      },
      {
        sourceId: "file_missing_path",
        yaml: `sources:
  file_missing_path:
    entity: coins
    type: file
    idFields: [id]
    file:
      format: json
  broken_other:
    entity: ignored
    type: api
`,
        expected: 'invalid source "file_missing_path": missing file.path',
      },
      {
        sourceId: "file_bad_format",
        yaml: `sources:
  file_bad_format:
    entity: coins
    type: file
    idFields: [id]
    file:
      path: data/coins.json
      format: xml
  broken_other:
    entity: ignored
    type: api
`,
        expected: 'invalid source "file_bad_format": unsupported file.format',
      },
      {
        sourceId: "file_missing_ids",
        yaml: `sources:
  file_missing_ids:
    entity: coins
    type: file
    file:
      path: data/coins.json
      format: json
  broken_other:
    entity: ignored
    type: api
`,
        expected: 'invalid source "file_missing_ids": missing idFields',
      },
      {
        sourceId: "file_valid",
        yaml: `sources:
  file_valid:
    entity: tickers
    type: file
    idFields: [symbol]
    file:
      path: data/json/coins.json
      format: json
  broken_other:
    entity: ignored
    type: api
`,
        expected: "",
      },
    ];

    for (const testCase of cases) {
      if (testCase.sourceId === "file_valid") {
        writeProjectFile(projectDir, "data/json/coins.json", JSON.stringify([{ symbol: "BTC" }]));
      }
      writeSources(projectDir, testCase.yaml);
      const result = await runCli(projectDir, ["source", "run", testCase.sourceId]);
      if (testCase.expected) {
        expect(result.stdout).toBe("");
        expect(result.stderr).toContain(testCase.expected);
      } else {
        expect(result.stderr).toBe("");
        expect(JSON.parse(result.stdout).recordsWritten).toBe(1);
      }
    }
  });

  it("ingests JSON file sources from project-relative paths and stores file metadata", async () => {
    const projectDir = makeTempProject("source-run-json-array");
    await runCli(projectDir, ["init"]);
    copyProjectFile(projectDir, sampleJsonPath, "data/json/tracked-tickers.json");
    writeProjectYaml(projectDir, [
      "projectId: source-run-json-array",
      'projectName: "Source Run JSON Array"',
      "defaultDatabase: local",
      "databases:",
      "  local:",
      "    type: sqlite",
      "    path: data/local.sqlite",
      "  research:",
      "    type: sqlite",
      "    path: data/research.sqlite",
    ]);
    fs.rmSync(path.join(projectDir, ".agent-pipe/data/research.sqlite"), { force: true });
    writeSources(
      projectDir,
      `sources:
  tracked_tickers:
    database: research
    entity: tickers
    type: file
    idFields: [symbol]
    file:
      path: data/json/tracked-tickers.json
      format: json
`,
    );

    const result = await runCli(projectDir, ["source", "run", "tracked_tickers"]);

    expect(result.stderr).toBe("");
    const output = JSON.parse(result.stdout) as { recordsWritten: number; jobRunId: string };
    expect(output.recordsWritten).toBe(11);
    expect(readRecords(projectDir, "local")).toHaveLength(0);
    const records = readRecords(projectDir, "research");
    expect(records).toHaveLength(11);
    expect(JSON.parse(String(records[0]?.payload_json))).toMatchObject({
      symbol: expect.any(String),
      company: expect.any(String),
    });
    expect(records.map((record) => JSON.parse(String(record.metadata_json)))).toEqual(
      expect.arrayContaining([
        {
          ingestionType: "file",
          path: "data/json/tracked-tickers.json",
          format: "json",
          itemIndex: 0,
        },
      ]),
    );
    expect(readJobRuns(projectDir, "local")).toHaveLength(0);
    expect(readJobRuns(projectDir, "research")).toEqual([
      {
        id: output.jobRunId,
        job_id: "tracked_tickers",
        entity: "tickers",
        status: "succeeded",
        started_at: expect.any(String),
        finished_at: expect.any(String),
        records_written: 11,
        error_message: null,
        metadata_json: JSON.stringify({ sourceId: "tracked_tickers" }),
      },
    ]);
  });

  it("ingests a top-level JSON object file as one record without itemIndex metadata", async () => {
    const projectDir = makeTempProject("source-run-json-object");
    await runCli(projectDir, ["init"]);
    writeProjectFile(projectDir, "data/json/one-ticker.json", JSON.stringify({ symbol: "BTC", price: 1 }, null, 2));
    writeSources(
      projectDir,
      `sources:
  one_ticker:
    entity: tickers
    type: file
    idFields: [symbol]
    file:
      path: data/json/one-ticker.json
      format: json
`,
    );

    const result = await runCli(projectDir, ["source", "run", "one_ticker"]);

    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout).recordsWritten).toBe(1);
    const records = readRecords(projectDir);
    expect(records).toHaveLength(1);
    expect(JSON.parse(String(records[0]?.payload_json))).toEqual({ symbol: "BTC", price: 1 });
    expect(JSON.parse(String(records[0]?.metadata_json))).toEqual({
      ingestionType: "file",
      path: "data/json/one-ticker.json",
      format: "json",
    });
  });

  it("fails clearly for invalid JSON file shapes and keeps writes all-or-nothing", async () => {
    const projectDir = makeTempProject("source-run-json-invalid");
    await runCli(projectDir, ["init"]);
    const cases = [
      {
        sourceId: "bad_json",
        filePath: "data/json/bad.json",
        content: "{bad",
        expected: 'invalid JSON file for source "bad_json"',
      },
      {
        sourceId: "primitive_json",
        filePath: "data/json/primitive.json",
        content: "42",
        expected: 'source "primitive_json" must return a top-level object or array',
      },
      {
        sourceId: "mixed_array",
        filePath: "data/json/mixed.json",
        content: JSON.stringify([{ symbol: "BTC" }, "ETH"]),
        expected: 'source "mixed_array" returned a non-object item',
      },
    ];

    for (const testCase of cases) {
      writeProjectFile(projectDir, testCase.filePath, testCase.content);
      writeSources(
        projectDir,
        `sources:
  ${testCase.sourceId}:
    entity: tickers
    type: file
    idFields: [symbol]
    file:
      path: ${testCase.filePath}
      format: json
`,
      );

      const result = await runCli(projectDir, ["source", "run", testCase.sourceId]);

      expect(result.stdout).toBe("");
      expect(result.stderr).toContain(testCase.expected);
      expect(readRecords(projectDir)).toHaveLength(0);
      expect(readJobRuns(projectDir)).toEqual([
        {
          id: expect.any(String),
          job_id: testCase.sourceId,
          entity: "tickers",
          status: "failed",
          started_at: expect.any(String),
          finished_at: expect.any(String),
          records_written: 0,
          error_message: expect.stringContaining(testCase.expected),
          metadata_json: JSON.stringify({ sourceId: testCase.sourceId }),
        },
      ]);
      fs.rmSync(path.join(projectDir, ".agent-pipe/data/local.sqlite"), { force: true });
    }
  });

  it("rejects absolute and project-escaping JSON file paths", async () => {
    const projectDir = makeTempProject("source-run-json-paths");
    await runCli(projectDir, ["init"]);
    const cases = [
      {
        sourceId: "absolute_path",
        filePath: sampleJsonPath,
        expected: 'absolute file.path is not allowed for source "absolute_path"',
      },
      {
        sourceId: "escaping_path",
        filePath: "../outside.json",
        expected: 'file.path must stay within the project root for source "escaping_path"',
      },
    ];

    for (const testCase of cases) {
      writeSources(
        projectDir,
        `sources:
  ${testCase.sourceId}:
    entity: tickers
    type: file
    idFields: [symbol]
    file:
      path: ${testCase.filePath}
      format: json
`,
      );

      const result = await runCli(projectDir, ["source", "run", testCase.sourceId]);

      expect(result.stdout).toBe("");
      expect(result.stderr).toContain(testCase.expected);
      expect(readRecords(projectDir)).toHaveLength(0);
      fs.rmSync(path.join(projectDir, ".agent-pipe/data/local.sqlite"), { force: true });
    }
  });

  it("ingests CSV file sources from project-relative paths and preserves string values", async () => {
    const projectDir = makeTempProject("source-run-csv-array");
    await runCli(projectDir, ["init"]);
    copyProjectFile(projectDir, sampleCsvPath, "data/csv/DFF.csv");
    writeSources(
      projectDir,
      `sources:
  fed_funds:
    entity: rates
    type: file
    idFields: [observation_date]
    file:
      path: data/csv/DFF.csv
      format: csv
`,
    );

    const result = await runCli(projectDir, ["source", "run", "fed_funds"]);

    expect(result.stderr).toBe("");
    const output = JSON.parse(result.stdout) as { recordsWritten: number };
    expect(output.recordsWritten).toBeGreaterThan(200);
    const records = readRecords(projectDir);
    expect(records.length).toBe(output.recordsWritten);
    expect(JSON.parse(String(records[0]?.payload_json))).toEqual({
      observation_date: "2021-07-06",
      DFF: "0.10",
    });
    expect(records.map((record) => JSON.parse(String(record.metadata_json)))).toEqual(
      expect.arrayContaining([
        {
          ingestionType: "file",
          path: "data/csv/DFF.csv",
          format: "csv",
          rowNumber: 2,
        },
      ]),
    );
  });

  it("parses CSV quoted commas and multiline quoted values", async () => {
    const projectDir = makeTempProject("source-run-csv-quotes");
    await runCli(projectDir, ["init"]);
    writeProjectFile(
      projectDir,
      "data/csv/notes.csv",
      ['id,title,body', '1,"Hello, world","first line', 'second line"', '2,"Plain","ok"', ""].join("\n"),
    );
    writeSources(
      projectDir,
      `sources:
  notes_csv:
    entity: notes
    type: file
    idFields: [id]
    file:
      path: data/csv/notes.csv
      format: csv
`,
    );

    const result = await runCli(projectDir, ["source", "run", "notes_csv"]);

    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout).recordsWritten).toBe(2);
    const payloads = readRecords(projectDir).map((record) => JSON.parse(String(record.payload_json)));
    expect(payloads).toEqual(
      expect.arrayContaining([
        {
          id: "1",
          title: "Hello, world",
          body: "first line\nsecond line",
        },
      ]),
    );
  });

  it("fails clearly for malformed CSV headers and malformed CSV content", async () => {
    const projectDir = makeTempProject("source-run-csv-invalid");
    await runCli(projectDir, ["init"]);
    const cases = [
      {
        sourceId: "blank_header",
        filePath: "data/csv/blank-header.csv",
        content: ",value\n1,ok\n",
        expected: 'missing CSV header row for source "blank_header"',
      },
      {
        sourceId: "headerless_csv",
        filePath: "data/csv/headerless.csv",
        content: "1,ok\n2,still-ok\n",
        expected: 'missing CSV header row for source "headerless_csv"',
      },
      {
        sourceId: "malformed_csv",
        filePath: "data/csv/malformed.csv",
        content: 'id,value\n1,"unterminated\n',
        expected: 'invalid CSV file for source "malformed_csv"',
      },
    ];

    for (const testCase of cases) {
      writeProjectFile(projectDir, testCase.filePath, testCase.content);
      writeSources(
        projectDir,
        `sources:
  ${testCase.sourceId}:
    entity: notes
    type: file
    idFields: [id]
    file:
      path: ${testCase.filePath}
      format: csv
`,
      );

      const result = await runCli(projectDir, ["source", "run", testCase.sourceId]);

      expect(result.stdout).toBe("");
      expect(result.stderr).toContain(testCase.expected);
      expect(readRecords(projectDir)).toHaveLength(0);
      expect(readJobRuns(projectDir)).toEqual([
        {
          id: expect.any(String),
          job_id: testCase.sourceId,
          entity: "notes",
          status: "failed",
          started_at: expect.any(String),
          finished_at: expect.any(String),
          records_written: 0,
          error_message: expect.stringContaining(testCase.expected),
          metadata_json: JSON.stringify({ sourceId: testCase.sourceId }),
        },
      ]);
      fs.rmSync(path.join(projectDir, ".agent-pipe/data/local.sqlite"), { force: true });
    }
  });

  it("keeps CSV writes all-or-nothing when any row has an invalid id field", async () => {
    const projectDir = makeTempProject("source-run-csv-atomic");
    await runCli(projectDir, ["init"]);
    writeProjectFile(projectDir, "data/csv/bad-ids.csv", "id,value\nok,1\n,2\n");
    writeSources(
      projectDir,
      `sources:
  bad_ids_csv:
    entity: notes
    type: file
    idFields: [id]
    file:
      path: data/csv/bad-ids.csv
      format: csv
`,
    );

    const result = await runCli(projectDir, ["source", "run", "bad_ids_csv"]);

    expect(result.stdout).toBe("");
    expect(result.stderr).toContain('id field "id" for entity "notes" cannot be empty');
    expect(readRecords(projectDir)).toHaveLength(0);
    expect(readJobRuns(projectDir)).toEqual([
      {
        id: expect.any(String),
        job_id: "bad_ids_csv",
        entity: "notes",
        status: "failed",
        started_at: expect.any(String),
        finished_at: expect.any(String),
        records_written: 0,
        error_message: expect.stringContaining('id field "id" for entity "notes" cannot be empty'),
        metadata_json: JSON.stringify({ sourceId: "bad_ids_csv" }),
      },
    ]);
  });

  it("ingests Markdown file sources with first H1 title extraction", async () => {
    const projectDir = makeTempProject("source-run-markdown-h1");
    await runCli(projectDir, ["init"]);
    copyProjectFile(
      projectDir,
      sampleMarkdownPath,
      "data/markdown/2026-07-06__agent-memory-tools-context-mode-codegraph.md",
    );
    writeSources(
      projectDir,
      `sources:
  research_note:
    entity: notes
    type: file
    idFields: [path]
    file:
      path: data/markdown/2026-07-06__agent-memory-tools-context-mode-codegraph.md
      format: markdown
`,
    );

    const result = await runCli(projectDir, ["source", "run", "research_note"]);

    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout).recordsWritten).toBe(1);
    const records = readRecords(projectDir);
    expect(records).toHaveLength(1);
    expect(JSON.parse(String(records[0]?.payload_json))).toEqual({
      path: "data/markdown/2026-07-06__agent-memory-tools-context-mode-codegraph.md",
      title: "Agent Memory Taxonomy: Where Do Context-Mode and Codegraph Belong?",
      content: fs.readFileSync(sampleMarkdownPath, "utf8"),
    });
    expect(JSON.parse(String(records[0]?.metadata_json))).toEqual({
      ingestionType: "file",
      path: "data/markdown/2026-07-06__agent-memory-tools-context-mode-codegraph.md",
      format: "markdown",
    });
  });

  it("falls back to the markdown filename when no H1 exists", async () => {
    const projectDir = makeTempProject("source-run-markdown-fallback");
    await runCli(projectDir, ["init"]);
    writeProjectFile(projectDir, "data/markdown/no-heading.md", "Paragraph one.\n\n## Section\n");
    writeSources(
      projectDir,
      `sources:
  no_heading_note:
    entity: notes
    type: file
    idFields: [path]
    file:
      path: data/markdown/no-heading.md
      format: markdown
`,
    );

    const result = await runCli(projectDir, ["source", "run", "no_heading_note"]);

    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout).recordsWritten).toBe(1);
    expect(JSON.parse(String(readRecords(projectDir)[0]?.payload_json))).toEqual({
      path: "data/markdown/no-heading.md",
      title: "no-heading",
      content: "Paragraph one.\n\n## Section\n",
    });
  });

  it("routes file sources to the configured non-default database for every supported format", async () => {
    const cases = [
      {
        sourceId: "json_research",
        entity: "tickers",
        filePath: "data/json/tracked-tickers.json",
        format: "json",
        idFields: ["symbol"],
        prepare: (projectDir: string) =>
          copyProjectFile(projectDir, sampleJsonPath, "data/json/tracked-tickers.json"),
        expectedRecords: 11,
      },
      {
        sourceId: "csv_research",
        entity: "rates",
        filePath: "data/csv/DFF.csv",
        format: "csv",
        idFields: ["observation_date"],
        prepare: (projectDir: string) =>
          copyProjectFile(projectDir, sampleCsvPath, "data/csv/DFF.csv"),
        expectedRecords: sampleCsvRowCount,
      },
      {
        sourceId: "markdown_research",
        entity: "notes",
        filePath: "data/markdown/2026-07-06__agent-memory-tools-context-mode-codegraph.md",
        format: "markdown",
        idFields: ["path"],
        prepare: (projectDir: string) =>
          copyProjectFile(
            projectDir,
            sampleMarkdownPath,
            "data/markdown/2026-07-06__agent-memory-tools-context-mode-codegraph.md",
          ),
        expectedRecords: 1,
      },
    ] as const;

    for (const testCase of cases) {
      const projectDir = makeTempProject(`source-run-file-routing-${testCase.format}`);
      await runCli(projectDir, ["init"]);
      writeProjectYaml(projectDir, [
        `projectId: source-run-file-routing-${testCase.format}`,
        `projectName: "Source Run File Routing ${testCase.format}"`,
        "defaultDatabase: local",
        "databases:",
        "  local:",
        "    type: sqlite",
        "    path: data/local.sqlite",
        "  research:",
        "    type: sqlite",
        "    path: data/research.sqlite",
      ]);
      fs.rmSync(path.join(projectDir, ".agent-pipe/data/research.sqlite"), { force: true });
      testCase.prepare(projectDir);
      writeSources(
        projectDir,
        `sources:
  ${testCase.sourceId}:
    database: research
    entity: ${testCase.entity}
    type: file
    idFields: [${testCase.idFields.join(", ")}]
    file:
      path: ${testCase.filePath}
      format: ${testCase.format}
`,
      );

      const result = await runCli(projectDir, ["source", "run", testCase.sourceId]);

      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout).recordsWritten).toBe(testCase.expectedRecords);
      expect(readRecords(projectDir, "local")).toHaveLength(0);
      expect(readRecords(projectDir, "research")).toHaveLength(testCase.expectedRecords);
      expect(readJobRuns(projectDir, "local")).toHaveLength(0);
      expect(readJobRuns(projectDir, "research")).toEqual([
        {
          id: expect.any(String),
          job_id: testCase.sourceId,
          entity: testCase.entity,
          status: "succeeded",
          started_at: expect.any(String),
          finished_at: expect.any(String),
          records_written: testCase.expectedRecords,
          error_message: null,
          metadata_json: JSON.stringify({ sourceId: testCase.sourceId }),
        },
      ]);
    }
  });

  it("fails clearly for unknown configured databases on file sources", async () => {
    const cases = [
      {
        sourceId: "json_missing_db",
        entity: "tickers",
        filePath: "data/json/tracked-tickers.json",
        format: "json",
        idFields: ["symbol"],
        prepare: (projectDir: string) =>
          copyProjectFile(projectDir, sampleJsonPath, "data/json/tracked-tickers.json"),
      },
      {
        sourceId: "csv_missing_db",
        entity: "rates",
        filePath: "data/csv/DFF.csv",
        format: "csv",
        idFields: ["observation_date"],
        prepare: (projectDir: string) =>
          copyProjectFile(projectDir, sampleCsvPath, "data/csv/DFF.csv"),
      },
      {
        sourceId: "markdown_missing_db",
        entity: "notes",
        filePath: "data/markdown/2026-07-06__agent-memory-tools-context-mode-codegraph.md",
        format: "markdown",
        idFields: ["path"],
        prepare: (projectDir: string) =>
          copyProjectFile(
            projectDir,
            sampleMarkdownPath,
            "data/markdown/2026-07-06__agent-memory-tools-context-mode-codegraph.md",
          ),
      },
    ] as const;

    for (const testCase of cases) {
      const projectDir = makeTempProject(`source-run-file-unknown-db-${testCase.format}`);
      await runCli(projectDir, ["init"]);
      testCase.prepare(projectDir);
      writeSources(
        projectDir,
        `sources:
  ${testCase.sourceId}:
    database: missing
    entity: ${testCase.entity}
    type: file
    idFields: [${testCase.idFields.join(", ")}]
    file:
      path: ${testCase.filePath}
      format: ${testCase.format}
`,
      );

      const result = await runCli(projectDir, ["source", "run", testCase.sourceId]);

      expect(result.stdout).toBe("");
      expect(result.stderr).toContain(`unknown database "missing" for source "${testCase.sourceId}"`);
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

  it("writes source records and run history to the configured source database", async () => {
    const ran = await withServer((req, res) => {
      if (req.url?.startsWith("/api/v3/coins/list")) {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify([{ id: "bitcoin" }]));
        return;
      }
      res.statusCode = 404;
      res.end();
    }, async (baseUrl) => {
      const projectDir = makeTempProject("source-run-research");
      await runCli(projectDir, ["init"]);
      writeProjectYaml(projectDir, [
        "projectId: source-run-research",
        'projectName: "Source Run Research"',
        "defaultDatabase: local",
        "databases:",
        "  local:",
        "    type: sqlite",
        "    path: data/local.sqlite",
        "  research:",
        "    type: sqlite",
        "    path: data/research.sqlite",
      ]);
      fs.rmSync(path.join(projectDir, ".agent-pipe/data/research.sqlite"), { force: true });
      writeSources(
        projectDir,
        `sources:
  smoke_source:
    database: research
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
`,
      );

      const result = await runCli(projectDir, ["source", "run", "smoke_source"]);
      expect(result.stderr).toBe("");
      expect(fs.existsSync(path.join(projectDir, ".agent-pipe/data/research.sqlite"))).toBe(true);
      expect(readRecords(projectDir, "local")).toHaveLength(0);
      expect(readRecords(projectDir, "research")).toHaveLength(1);
      expect(readJobRuns(projectDir, "local")).toHaveLength(0);
      expect(readJobRuns(projectDir, "research")[0]?.job_id).toBe("smoke_source");
    });
    if (!ran) {
      return;
    }
  });

  it("fails clearly for unknown configured source databases", async () => {
    const projectDir = makeTempProject("source-run-unknown-db");
    await runCli(projectDir, ["init"]);
    writeSources(
      projectDir,
      `sources:
  smoke_source:
    database: missing
    entity: coins_list
    type: api
    idFields:
      - id
    api:
      baseUrl: http://example.test
      endpoint: /coins/list
      method: GET
      payloadPath: $
      pagination:
        type: none
`,
    );

    const result = await runCli(projectDir, ["source", "run", "smoke_source"]);
    expect(result.stderr).toContain('unknown database "missing" for source "smoke_source"');
  });
});
