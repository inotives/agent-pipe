---
id: task-0020
title: "Phase 5: add scheduler start --once due-job execution"
type: task
status: ready
assigned_to: worker
created_by: human
created_on: 2026-07-06
updated_on: 2026-07-06
priority: normal
parent: ""
depends_on:
  - task-0019
message: ""
---

# Task

## Context
After schedule parsing exists, Phase 5 needs a deterministic scheduler tick that can be tested without running an infinite loop.

Source of truth: `docs/phase-5-local-scheduler.md`.

## Goal
Add `agent-pipe scheduler start --once` that runs due cron jobs for the current minute.

## Scope
- Add the `scheduler` command group and `start` command.
- Add `--once`.
- Evaluate cron jobs against the current minute.
- Ignore manual jobs and jobs with missing schedules.
- Dispatch due jobs through the existing `runJob` path.
- Print newline-delimited JSON events for one tick.
- Add focused tests for due, not-due, and manual jobs.

## Planner Notes
Do not add the continuous loop in this task. Keep this as a single-tick implementation so the scheduler core is easy to test.

Due policy:

- Only the current minute is considered.
- Missed older schedules are not caught up.

## Implementation Plan
1. Add a scheduler module with a single-tick function.
2. Wire `scheduler start --once` into the CLI.
3. Load project state and schedules using existing helpers.
4. Find cron jobs due in the current minute.
5. Run due jobs one at a time through `runJob`.
6. Emit JSON-line events to stdout.
7. Add tests around due matching and manual job exclusion.

## Acceptance Criteria

- [ ] `agent-pipe scheduler start --once` exists.
- [ ] A due cron job runs and writes records through the existing job runner.
- [ ] Run history is recorded through the existing job runner.
- [ ] Manual jobs do not auto-run.
- [ ] Jobs with missing schedule do not auto-run.
- [ ] A not-due cron job does not run.
- [ ] Scheduler output is newline-delimited JSON.
- [ ] `npm test` passes.
- [ ] `npm run typecheck` passes.

## Notes
