---
id: task-0021
title: "Phase 5: add scheduler loop mode and JSON-line events"
type: task
status: done
assigned_to: worker
created_by: human
created_on: 2026-07-06
updated_on: 2026-07-06
priority: normal
parent: ""
depends_on:
  - task-0020
message: "Reviewed: scheduler start now loops with a 60000ms default poll
  interval, accepts valid overrides, rejects invalid poll intervals with a clear
  message including non-numeric input, emits JSON-line scheduler events with
  timestamps, preserves scheduler-only running-job skip behavior and failed run
  history, and npm test plus npm run typecheck and git diff --check all passed."
---





# Task

## Context
Phase 5 needs `agent-pipe scheduler start` as a local loop, not only `--once`.

Source of truth: `docs/phase-5-local-scheduler.md`.

## Goal
Add continuous scheduler loop behavior, poll interval validation, and scheduler-level one-job-at-a-time locking.

## Scope
- Make `agent-pipe scheduler start` loop until interrupted.
- Add `--poll-interval-ms <ms>`.
- Default poll interval to `60000`.
- Validate poll interval as a positive integer.
- Before dispatching a scheduled job, skip if any `job_runs` row has `status = running`.
- Emit the Phase 5 JSON-line scheduler events.
- Add focused tests for validation and running-lock skip behavior.

## Planner Notes
Do not change manual `agent-pipe run --job` behavior. The global lock is scheduler-only.

Expected events include:

- `scheduler_started`
- `tick_started`
- `job_due`
- `job_succeeded`
- `job_failed`
- `job_skipped`
- `tick_finished`

## Implementation Plan
1. Reuse the single-tick scheduler core from task 0020.
2. Add a loop wrapper for normal `scheduler start`.
3. Parse and validate `--poll-interval-ms`.
4. Add a scheduler-only check for any currently running job.
5. Emit `job_skipped` when the scheduler lock prevents dispatch.
6. Add tests using `--once` or direct scheduler core calls where possible to avoid slow loops.

## Acceptance Criteria

- [ ] `agent-pipe scheduler start` loops by default.
- [ ] Default poll interval is `60000`.
- [ ] `--poll-interval-ms <ms>` overrides the default.
- [ ] Invalid poll interval fails clearly.
- [ ] Scheduler skips dispatch when any job is already `running`.
- [ ] Manual `run --job` locking behavior remains unchanged.
- [ ] JSON-line events include timestamps.
- [ ] Failed scheduled jobs emit a failure event and leave failed run history.
- [ ] `npm test` passes.
- [ ] `npm run typecheck` passes.

## Notes

- Reviewer finding 2026-07-06: `scheduler start --poll-interval-ms` does not fail clearly for non-numeric input. Repro: in a fresh temp project, `node --import /Users/inotives/workspaces/agent-pipe/node_modules/tsx/dist/loader.mjs /Users/inotives/workspaces/agent-pipe/src/index.ts scheduler start --poll-interval-ms abc` prints `Invalid input: expected number, received NaN`. The Phase 5 contract says invalid poll intervals must fail clearly, and the current `z.coerce.number().int().positive(...)` path in `src/cli.ts` only gives the intended message for some invalid values like `0`. Please normalize all invalid poll-interval inputs, including non-numeric strings, to a clear message such as `poll interval must be a positive integer`, and add coverage for that CLI case in `tests/scheduler.test.ts`.
