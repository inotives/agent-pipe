import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];
const repoRoot = path.resolve(__dirname, "..");
const tsxLoader = path.join(repoRoot, "node_modules/tsx/dist/loader.mjs");
const cliEntry = path.join(repoRoot, "src/index.ts");

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

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("Phase 1 acceptance", () => {
  it("covers init, put, rerun idempotence, and README quickstart content", () => {
    const readme = fs.readFileSync(path.join(repoRoot, "README.md"), "utf8");
    expect(readme).toContain("npm run agent-pipe -- init");
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
});
