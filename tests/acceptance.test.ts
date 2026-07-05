import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile, execFileSync } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { promisify } from "node:util";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];
const repoRoot = path.resolve(__dirname, "..");
const tsxLoader = path.join(repoRoot, "node_modules/tsx/dist/loader.mjs");
const cliEntry = path.join(repoRoot, "src/index.ts");
const execFileAsync = promisify(execFile);

function makeTempProject(name: string): string {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "agent-pipe-acceptance-"));
  const dir = path.join(parent, name);
  fs.mkdirSync(dir, { recursive: true });
  tempDirs.push(parent);
  return dir;
}

function runCli(cwd: string, args: string[]): string {
  return execFileSync(process.execPath, ["--import", tsxLoader, cliEntry, ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function runCliAsync(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, ["--import", tsxLoader, cliEntry, ...args], {
      cwd,
      encoding: "utf8",
    });
    return { stdout, stderr };
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

async function withServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
  run: (baseUrl: string) => Promise<void> | void,
): Promise<boolean> {
  const server = createServer(handler);
  try {
    try {
      await new Promise<void>((resolve, reject) =>
        server.listen(0, "127.0.0.1", () => resolve()).once("error", reject),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") {
        return false;
      }
      throw error;
    }

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("failed to start acceptance test server");
    }
    await run(`http://127.0.0.1:${address.port}`);
    return true;
  } finally {
    if (server.listening) {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
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

describe("Phase acceptance", () => {
  it("covers Phase 1 init, put, rerun idempotence, and README quickstart content", () => {
    const readme = fs.readFileSync(path.join(repoRoot, "README.md"), "utf8");
    expect(readme).toContain("npm run agent-pipe -- init");
    expect(readme).toContain("npm run agent-pipe -- records list");
    expect(readme).toContain(`npm run agent-pipe -- records show 'my-project:coins_list:[\"bitcoin\"]'`);
    expect(readme).toContain("npm run agent-pipe -- source list");
    expect(readme).toContain("npm run agent-pipe -- source run coingecko_coins_list");
    expect(readme).toContain("npm run agent-pipe -- runs list");
    expect(readme).toContain("npm run agent-pipe -- runs show '<job-run-id>'");
    expect(readme).toContain("npm run agent-pipe -- put --entity coins_list --file ./coins.json");
    expect(readme).toContain("npm test");
    expect(readme).toContain("npm run typecheck");
    expect(readme).toContain('{ "id": "bitcoin", "symbol": "btc", "name": "Bitcoin" }');
    expect(readme).toContain('{ "id": "ethereum", "symbol": "eth", "name": "Ethereum" }');

    const projectDir = makeTempProject("acceptance-project");
    fs.writeFileSync(
      path.join(projectDir, "coins.json"),
      JSON.stringify([
        { id: "bitcoin", symbol: "btc", name: "Bitcoin" },
        { id: "ethereum", symbol: "eth", name: "Ethereum" },
      ]),
      "utf8",
    );

    const initResult = JSON.parse(runCli(projectDir, ["init"])) as { projectId: string };
    const firstPut = JSON.parse(
      runCli(projectDir, ["put", "--entity", "coins_list", "--file", "./coins.json"]),
    ) as { projectId: string; entity: string; recordsWritten: number };
    const secondPut = JSON.parse(
      runCli(projectDir, ["put", "--entity", "coins_list", "--file", "./coins.json"]),
    ) as { recordsWritten: number };

    expect(initResult.projectId).toBe("acceptance-project");
    expect(firstPut).toEqual({
      projectId: "acceptance-project",
      entity: "coins_list",
      recordsWritten: 2,
    });
    expect(secondPut.recordsWritten).toBe(2);

    const recordsList = runCli(projectDir, ["records", "list"]);
    expect(recordsList).toContain("ID");
    expect(recordsList).toContain('acceptance-project:coins_list:["bitcoin"]');
    expect(recordsList).toContain('acceptance-project:coins_list:["ethereum"]');

    const recordShow = JSON.parse(
      runCli(projectDir, ["records", "show", 'acceptance-project:coins_list:["bitcoin"]']),
    ) as {
      id: string;
      project_id: string;
      entity: string;
      local_id: string;
      source: string | null;
      payload: Record<string, unknown>;
      metadata: Record<string, unknown> | null;
      deleted_at: string | null;
    };
    expect(recordShow).toMatchObject({
      id: 'acceptance-project:coins_list:["bitcoin"]',
      project_id: "acceptance-project",
      entity: "coins_list",
      local_id: '["bitcoin"]',
      source: "file",
      payload: { id: "bitcoin", symbol: "btc", name: "Bitcoin" },
      metadata: { inputFile: "./coins.json" },
      deleted_at: null,
    });

    const database = new Database(path.join(projectDir, ".agent-pipe/data/local.sqlite"), {
      readonly: true,
    });
    try {
      const count = database.prepare("select count(*) as count from records").get() as { count: number };
      const ids = database.prepare("select id from records order by id").all() as Array<{ id: string }>;

      expect(count.count).toBe(2);
      expect(ids.map((row) => row.id)).toEqual([
        'acceptance-project:coins_list:["bitcoin"]',
        'acceptance-project:coins_list:["ethereum"]',
      ]);
    } finally {
      database.close();
    }
  });

  it("covers Phase 2 init, source list, source run, and failure persistence with a local API", async () => {
    const ran = await withServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      res.setHeader("content-type", "application/json");
      if (url.pathname === "/coins/list") {
        res.end(JSON.stringify([{ id: "bitcoin" }, { id: "ethereum" }]));
        return;
      }
      if (url.pathname === "/coins/history/bitcoin") {
        res.end(JSON.stringify({ date: "30-12-2025", price: 1 }));
        return;
      }
      if (url.pathname === "/coins/markets") {
        const page = url.searchParams.get("page");
        if (page === "1") {
          res.end(JSON.stringify([{ id: "btc" }]));
          return;
        }
        res.statusCode = 500;
        res.end(JSON.stringify({ error: "boom" }));
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ error: "not found" }));
    }, async (baseUrl) => {
      const projectDir = makeTempProject("acceptance-sources");
      const envLocalPath = path.join(projectDir, ".agent-pipe", ".env.local");

      const initResult = JSON.parse(runCli(projectDir, ["init"])) as { projectId: string };
      fs.appendFileSync(envLocalPath, "\nACCEPTANCE_API_KEY=test-key\n", "utf8");
      fs.writeFileSync(
        path.join(projectDir, ".agent-pipe", "sources.yaml"),
        `sources:
  smoke_list:
    entity: coins_list
    type: api
    idFields: [id]
    api:
      baseUrl: ${baseUrl}
      endpoint: /coins/list
      method: GET
      payloadPath: $
      pagination:
        type: none
  smoke_history:
    entity: coin_history
    type: api
    idFields: [id, date]
    api:
      baseUrl: ${baseUrl}
      endpoint: /coins/history/{id}
      method: GET
      params:
        id: bitcoin
      query:
        date: 30-12-2025
        api_key: \${ACCEPTANCE_API_KEY}
      payloadPath: $
      pagination:
        type: none
  flaky_page:
    entity: coins_markets
    type: api
    idFields: [id]
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
        maxPages: 2
        stopWhen: empty_page
      rateLimit:
        minDelayMs: 1
`,
        "utf8",
      );

      expect(initResult.projectId).toBe("acceptance-sources");
      const listResult = await runCliAsync(projectDir, ["source", "list"]);
      expect(listResult.stderr).toBe("");
      expect(listResult.stdout).toContain("smoke_list");

      const listRunResult = await runCliAsync(projectDir, ["source", "run", "smoke_list"]);
      expect(listRunResult.stderr).toBe("");
      const listRun = JSON.parse(listRunResult.stdout) as {
        sourceId: string;
        entity: string;
        recordsWritten: number;
        jobRunId: string;
      };
      expect(listRun).toEqual({
        sourceId: "smoke_list",
        entity: "coins_list",
        recordsWritten: 2,
        jobRunId: listRun.jobRunId,
      });

      const historyRunResult = await runCliAsync(projectDir, ["source", "run", "smoke_history"]);
      expect(historyRunResult.stderr).toBe("");
      const historyRun = JSON.parse(historyRunResult.stdout) as {
        jobRunId: string;
        recordsWritten: number;
      };
      expect(historyRun.recordsWritten).toBe(1);

      const flakyRun = await runCliAsync(projectDir, ["source", "run", "flaky_page"]);
      expect(flakyRun.stdout).toBe("");
      expect(flakyRun.stderr).toContain("request failed with status 500");

      const runsList = await runCliAsync(projectDir, ["runs", "list"]);
      expect(runsList.stderr).toBe("");
      expect(runsList.stdout).toContain("JOB_ID");
      expect(runsList.stdout).toContain("smoke_list");
      expect(runsList.stdout).toContain("flaky_page");

      const database = new Database(path.join(projectDir, ".agent-pipe/data/local.sqlite"), {
        readonly: true,
      });
      try {
        const records = database
          .prepare("select id, source, metadata_json from records order by id")
          .all() as Array<{ id: string; source: string; metadata_json: string }>;
        const jobRuns = database
          .prepare("select id, job_id, status, records_written, error_message from job_runs order by started_at, id")
          .all() as Array<{
            id: string;
            job_id: string;
            status: string;
            records_written: number;
            error_message: string | null;
          }>;

        expect(records.map((row) => row.id)).toEqual([
          'acceptance-sources:coin_history:["bitcoin","30-12-2025"]',
          'acceptance-sources:coins_list:["bitcoin"]',
          'acceptance-sources:coins_list:["ethereum"]',
          'acceptance-sources:coins_markets:["btc"]',
        ]);
        expect(records.map((row) => row.source)).toEqual([
          "smoke_history",
          "smoke_list",
          "smoke_list",
          "flaky_page",
        ]);
        expect(JSON.parse(records[0]!.metadata_json)).toMatchObject({
          ingestionType: "api",
          statusCode: 200,
        });
        expect(jobRuns).toEqual([
          {
            id: listRun.jobRunId,
            job_id: "smoke_list",
            status: "succeeded",
            records_written: 2,
            error_message: null,
          },
          {
            id: historyRun.jobRunId,
            job_id: "smoke_history",
            status: "succeeded",
            records_written: 1,
            error_message: null,
          },
          {
            id: jobRuns[2]!.id,
            job_id: "flaky_page",
            status: "failed",
            records_written: 1,
            error_message: expect.stringContaining("request failed with status 500"),
          },
        ]);

        const runShow = JSON.parse(runCli(projectDir, ["runs", "show", jobRuns[2]!.id])) as {
          id: string;
          job_id: string;
          status: string;
          records_written: number;
          error_message: string | null;
          metadata: Record<string, unknown> | null;
        };
        expect(runShow).toMatchObject({
          id: jobRuns[2]!.id,
          job_id: "flaky_page",
          status: "failed",
          records_written: 1,
          error_message: expect.stringContaining("request failed with status 500"),
          metadata: { sourceId: "flaky_page" },
        });
      } finally {
        database.close();
      }
    });

    void ran;
  });
});
