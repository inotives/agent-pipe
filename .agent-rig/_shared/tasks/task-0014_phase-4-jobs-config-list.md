---
id: task-0014
title: "Phase 4: add jobs config parsing and jobs list"
type: task
status: ready
assigned_to: worker
created_by: human
created_on: 2026-07-05
updated_on: 2026-07-05
priority: normal
parent: ""
depends_on: []
message: ""
---

# Task

## Context
Phase 4 adds manual job execution before scheduler work. The source of truth is `docs/phase-4-manual-job-runner.md`.

## Goal
Add job config parsing and `agent-pipe jobs list`.

## Scope
- Parse `jobs` from `.agent-pipe/schedules.yaml` as a map keyed by job ID.
- Treat existing empty `jobs: []` as no jobs for compatibility.
- Update new init defaults to write `jobs: {}`.
- Add `agent-pipe jobs list`.
- Add `agent-pipe jobs list --json`.
- Do not execute jobs in this task.
- Do not add scheduler, cron, retries, or output files.

## Planner Notes
- Job shape:
  ```yaml
  jobs:
    collect_prices:
      entity: coins_list
      command: npm run collect:prices
      timeoutMs: 60000
  ```
- Each job must define `entity` and `command`.
- `timeoutMs` is optional.
- `jobs list` table columns are `JOB_ID`, `ENTITY`, `COMMAND`.
- `jobs list --json` returns the same compact fields as JSON.
- Empty table output prints only the header row.
- Empty JSON output is `[]`.

## Implementation Plan
1. Add shared schedules/job parsing that can also be reused by `run --job`.
2. Update init default `schedules.yaml` for new projects.
3. Wire `jobs list` into the CLI.
4. Add focused tests for map jobs, empty array compatibility, table output, JSON output, and invalid job config.

## Acceptance Criteria

- [ ] New `agent-pipe init` writes `jobs: {}`.
- [ ] Existing `jobs: []` is treated as an empty jobs list.
- [ ] `npm run agent-pipe -- jobs list` prints `JOB_ID`, `ENTITY`, `COMMAND`.
- [ ] `jobs list --json` prints compact JSON rows.
- [ ] Empty jobs list outputs header-only table or `[]` JSON.
- [ ] Invalid job config fails clearly.
- [ ] `npm test` passes for relevant jobs-list tests.
- [ ] `npm run typecheck` passes.

## Notes
