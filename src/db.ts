import fs from "node:fs";
import path from "node:path";

import { findProjectRoot } from "./project.js";
import { bootstrapAllConfiguredDatabases, inspectAllConfiguredDatabases } from "./runtime.js";

export function runDbInit(cwd: string): string {
  const projectConfigPath = resolveProjectConfigPath(cwd);
  return JSON.stringify({ databases: bootstrapAllConfiguredDatabases(projectConfigPath) });
}

export function runDbStatus(cwd: string): string {
  const projectConfigPath = resolveProjectConfigPath(cwd);
  return JSON.stringify({ databases: inspectAllConfiguredDatabases(projectConfigPath) });
}

function resolveProjectConfigPath(cwd: string): string {
  const projectRoot = findProjectRoot(cwd);
  if (!projectRoot) {
    throw new Error("missing .agent-pipe project; run `agent-pipe init` first");
  }

  const projectConfigPath = path.join(projectRoot, ".agent-pipe", "project.yaml");
  if (!fs.existsSync(projectConfigPath)) {
    throw new Error("missing .agent-pipe/project.yaml; run `agent-pipe init` first");
  }

  return projectConfigPath;
}
