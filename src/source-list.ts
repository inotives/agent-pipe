import fs from "node:fs";
import path from "node:path";

import { parse } from "yaml";

import { findProjectRoot } from "./project.js";

type SourceListOptions = {
  json?: boolean;
};

type SourceSummary = {
  sourceId: string;
  entity: string;
  type: string;
};

export function runSourceList(cwd: string, options: SourceListOptions): string {
  const projectRoot = findProjectRoot(cwd);
  if (!projectRoot) {
    throw new Error("missing .agent-pipe project; run `agent-pipe init` first");
  }

  const sourcesPath = path.join(projectRoot, ".agent-pipe", "sources.yaml");
  if (!fs.existsSync(sourcesPath)) {
    throw new Error("missing .agent-pipe/sources.yaml; run `agent-pipe init` first");
  }

  const sources = loadSourceSummaries(sourcesPath);
  if (options.json) {
    return JSON.stringify(sources);
  }
  return formatSourceTable(sources);
}

function loadSourceSummaries(sourcesPath: string): SourceSummary[] {
  try {
    const parsed = parse(fs.readFileSync(sourcesPath, "utf8")) as { sources?: unknown };
    if (!parsed || typeof parsed !== "object" || !parsed.sources || typeof parsed.sources !== "object") {
      throw new Error("invalid .agent-pipe/sources.yaml");
    }
    return Object.entries(parsed.sources as Record<string, unknown>).map(([sourceId, config]) => {
      const summary = config && typeof config === "object" ? (config as Record<string, unknown>) : {};
      return {
        sourceId,
        entity: readSummaryField(summary.entity),
        type: readSummaryField(summary.type),
      };
    });
  } catch {
    throw new Error("invalid .agent-pipe/sources.yaml");
  }
}

function readSummaryField(value: unknown): string {
  return typeof value === "string" && value.trim() ? value : "unknown";
}

function formatSourceTable(sources: SourceSummary[]): string {
  const headers = ["SOURCE ID", "ENTITY", "TYPE"] as const;
  const rows = sources.map((source) => [source.sourceId, source.entity, source.type]);
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index].length)),
  );

  const formatRow = (row: readonly string[]) =>
    row.map((value, index) => value.padEnd(widths[index])).join("  ").trimEnd();

  return `${formatRow(headers)}\n${rows.map((row) => formatRow(row)).join("\n")}`;
}
