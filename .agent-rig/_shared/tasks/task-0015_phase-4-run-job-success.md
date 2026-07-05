---
id: task-0015
title: "Phase 4: implement run --job success path"
type: task
status: done
assigned_to: worker
created_by: human
created_on: 2026-07-05
updated_on: 2026-07-05
priority: normal
parent: ""
depends_on:
  - task-0014
message: Implemented run --job success path with shared runtime helpers and
  focused tests.
---





# Task

## Context
Phase 4 jobs are configured in `.agent-pipe/schedules.yaml` and produce clean stdout JSON. The source of truth is `docs/phase-4-manual-job-runner.md`.

## Goal
Implement the successful `agent-pipe run --job <jobId>` path.

## Scope
- Add `agent-pipe run --job <jobId>`.
- Look up a configured job by job ID.
- Run the configured shell command from the project root.
- Parse stdout as a JSON object or array of objects.
- Write records using the job entity and existing entity `idFields`.
- Use `records.source = jobId`.
- Write `job_runs` status from `running` to `succeeded`.
- Print compact JSON on success.
- Do not implement failure hardening, timeout, env loading, or same-job lock in this task unless needed for the basic path.

## Planner Notes
- Success output:
  ```json
  {
    "jobId": "collect_prices",
    "entity": "coins_list",
    "recordsWritten": 2,
    "jobRunId": "..."
  }
  ```
- `records.metadata_json` includes `jobId`, `command`, and `ingestionType: "job"`.
- `job_runs.metadata_json` includes at least `jobId`, `command`, `exitCode`, `durationMs`, and `timeoutMs`.
- Successful reruns use existing upsert behavior.

## Implementation Plan
1. Add a job runner module that reuses the parser from `task-0014`.
2. Insert a `running` job row before command execution.
3. Execute the shell command from the project root.
4. Parse stdout JSON and write records through the existing record builder/upsert path.
5. Mark the job row `succeeded` and return compact JSON.
6. Add focused success-path tests.

## Acceptance Criteria

- [ ] `npm run agent-pipe -- run --job <jobId>` executes the configured command.
- [ ] Stdout JSON object writes one record.
- [ ] Stdout JSON array writes one record per item.
- [ ] Records use `source = jobId`.
- [ ] Record metadata includes job provenance.
- [ ] `job_runs` moves from `running` to `succeeded`.
- [ ] Successful output is compact JSON with `jobId`, `entity`, `recordsWritten`, and `jobRunId`.
- [ ] Rerunning the same job is idempotent through existing upsert behavior.
- [ ] `npm test` passes for relevant success-path tests.
- [ ] `npm run typecheck` passes.

## Notes
