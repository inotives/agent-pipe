import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadSchedulesConfig } from "../src/schedules.js";

const tempDirs: string[] = [];

function writeSchedulesFile(name: string, contents: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `agent-pipe-schedules-${name}-`));
  tempDirs.push(dir);
  const schedulesPath = path.join(dir, "schedules.yaml");
  fs.writeFileSync(schedulesPath, contents, "utf8");
  return schedulesPath;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("loadSchedulesConfig", () => {
  it("parses cron schedules", () => {
    const schedulesPath = writeSchedulesFile(
      "cron",
      [
        "entities:",
        "  coins_list:",
        "    idFields:",
        "      - id",
        "jobs:",
        "  collect_prices:",
        "    entity: coins_list",
        "    command: npm run collect:prices",
        "    schedule:",
        "      type: cron",
        "      expression: \"5 0 * * *\"",
        "",
      ].join("\n"),
    );

    const config = loadSchedulesConfig(schedulesPath);

    expect(config.jobs.collect_prices.schedule).toEqual({
      type: "cron",
      expression: "5 0 * * *",
    });
  });

  it("parses manual schedules", () => {
    const schedulesPath = writeSchedulesFile(
      "manual",
      [
        "entities:",
        "  coins_list:",
        "    idFields:",
        "      - id",
        "jobs:",
        "  refresh_reference_data:",
        "    entity: coins_list",
        "    command: npm run refresh:reference",
        "    schedule:",
        "      type: manual",
        "",
      ].join("\n"),
    );

    const config = loadSchedulesConfig(schedulesPath);

    expect(config.jobs.refresh_reference_data.schedule).toEqual({
      type: "manual",
    });
  });

  it("treats missing schedule as manual", () => {
    const schedulesPath = writeSchedulesFile(
      "missing-schedule",
      [
        "entities:",
        "  coins_list:",
        "    idFields:",
        "      - id",
        "jobs:",
        "  collect_prices:",
        "    entity: coins_list",
        "    command: npm run collect:prices",
        "",
      ].join("\n"),
    );

    const config = loadSchedulesConfig(schedulesPath);

    expect(config.jobs.collect_prices.schedule).toEqual({
      type: "manual",
    });
  });

  it("fails clearly for invalid cron expressions", () => {
    const schedulesPath = writeSchedulesFile(
      "invalid-cron",
      [
        "entities:",
        "  coins_list:",
        "    idFields:",
        "      - id",
        "jobs:",
        "  collect_prices:",
        "    entity: coins_list",
        "    command: npm run collect:prices",
        "    schedule:",
        "      type: cron",
        "      expression: \"not a cron\"",
        "",
      ].join("\n"),
    );

    expect(() => loadSchedulesConfig(schedulesPath)).toThrowError(
      'invalid job "collect_prices": invalid cron expression',
    );
  });

  it("keeps phase 4 jobs array compatibility", () => {
    const schedulesPath = writeSchedulesFile(
      "jobs-array",
      [
        "entities:",
        "  coins_list:",
        "    idFields:",
        "      - id",
        "jobs: []",
        "",
      ].join("\n"),
    );

    const config = loadSchedulesConfig(schedulesPath);

    expect(config.jobs).toEqual({});
  });
});
