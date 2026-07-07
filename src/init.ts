import fs from "node:fs";
import path from "node:path";

import {
  findParentProjectRoot,
  humanizeProjectId,
  normalizeProjectId,
  validateProjectId,
} from "./project.js";
import { bootstrapProjectDatabase, resolveProjectDatabase } from "./runtime.js";

type InitOptions = {
  projectId?: string;
  projectName?: string;
};

type InitResult = {
  projectId: string;
  projectName: string;
  paths: {
    root: string;
    projectConfig: string;
    schedulesConfig: string;
    database: string;
    logs: string;
  };
};

const DEFAULT_SOURCES_YAML = `sources:
  coingecko_coins_list:
    entity: coins_list
    type: api
    idFields:
      - id
    api:
      baseUrl: https://api.coingecko.com/api/v3
      endpoint: /coins/list
      method: GET
      query:
        include_platform: false
      payloadPath: $
      pagination:
        type: none
      rateLimit:
        minDelayMs: 10000

  coingecko_coins_markets:
    entity: coins_markets
    type: api
    idFields:
      - id
    api:
      baseUrl: https://api.coingecko.com/api/v3
      endpoint: /coins/markets
      method: GET
      query:
        vs_currency: usd
        per_page: 250
      payloadPath: $
      pagination:
        type: page
        pageParam: page
        perPageParam: per_page
        startPage: 1
        maxPages: 2
        stopWhen: empty_page
      rateLimit:
        minDelayMs: 10000

  coingecko_coin_history:
    entity: coin_history
    type: api
    idFields:
      - id
      - date
    api:
      baseUrl: https://api.coingecko.com/api/v3
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
      rateLimit:
        minDelayMs: 10000
`;
const DEFAULT_ENV_LOCAL = "# Local source credentials\n";

export function runInit(cwd: string, options: InitOptions): InitResult {
  assertNoParentProject(cwd);

  const rootDir = path.resolve(cwd);
  const stateDir = path.join(rootDir, ".agent-pipe");
  const dataDir = path.join(stateDir, "data");
  const logsDir = path.join(stateDir, "logs");
  const projectConfigPath = path.join(stateDir, "project.yaml");

  const projectId = validateProjectId(
    options.projectId ?? normalizeProjectId(path.basename(rootDir)),
  );
  const projectName = options.projectName?.trim() || humanizeProjectId(projectId);

  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(logsDir, { recursive: true });

  writeIfMissing(
    projectConfigPath,
    [
      `projectId: ${projectId}`,
      `projectName: ${toYamlString(projectName)}`,
      "defaultDatabase: local",
      "databases:",
      "  local:",
      "    type: sqlite",
      "    path: data/local.sqlite",
      "",
    ].join("\n"),
  );
  writeIfMissing(
    path.join(stateDir, "schedules.yaml"),
    "entities:\n  coins_list:\n    idFields:\n      - id\njobs: {}\n",
  );
  writeIfMissing(path.join(stateDir, "sources.yaml"), DEFAULT_SOURCES_YAML);
  writeIfMissing(path.join(stateDir, ".env.local"), DEFAULT_ENV_LOCAL);

  const resolvedDatabase = resolveProjectDatabase(projectConfigPath);
  bootstrapProjectDatabase(resolvedDatabase.absolutePath);

  return {
    projectId,
    projectName,
    paths: {
      root: ".agent-pipe",
      projectConfig: ".agent-pipe/project.yaml",
      schedulesConfig: ".agent-pipe/schedules.yaml",
      database: path.join(".agent-pipe", resolvedDatabase.path),
      logs: ".agent-pipe/logs",
    },
  };
}

function assertNoParentProject(startDir: string): void {
  const parentRoot = findParentProjectRoot(startDir);
  if (parentRoot) {
    throw new Error(`nested projects are not supported; parent project found at ${parentRoot}`);
  }
}

function writeIfMissing(filePath: string, content: string): void {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, content, "utf8");
  }
}

function toYamlString(value: string): string {
  return JSON.stringify(value);
}
