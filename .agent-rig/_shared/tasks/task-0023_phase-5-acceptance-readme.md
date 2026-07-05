---
id: task-0023
title: "Phase 5: add acceptance coverage and README scheduler workflow"
type: task
status: ready
assigned_to: worker
created_by: human
created_on: 2026-07-06
updated_on: 2026-07-06
priority: normal
parent: ""
depends_on:
  - task-0022
message: ""
---

# Task

## Context
Phase 5 needs one end-to-end acceptance path and README updates so the new scheduler workflow is visible.

Source of truth: `docs/phase-5-local-scheduler.md`.

## Goal
Add acceptance coverage for scheduler `--once` and update README quickstart examples.

## Scope
- Extend acceptance tests with a local cron job collector.
- Run `scheduler start --once`.
- Verify records through `records list` or `records show`.
- Verify run history through `runs list` or `runs show`.
- Update README with scheduler and clear-running examples.
- Do not add live API smoke tests.

## Planner Notes
Keep the collector local and deterministic. Avoid real clock flakiness by generating a cron expression matching the test's current minute.

## Implementation Plan
1. Add an acceptance test project using `init`.
2. Write a small local collector script that prints JSON.
3. Configure a cron job due for the current minute.
4. Run `scheduler start --once`.
5. Assert records and run history are visible through CLI commands.
6. Add README quickstart commands for scheduler start and clear-running.

## Acceptance Criteria

- [ ] Acceptance test proves `init` plus cron job plus `scheduler start --once`.
- [ ] Acceptance test verifies written records.
- [ ] Acceptance test verifies run history.
- [ ] README includes `scheduler start --once`.
- [ ] README includes `scheduler start`.
- [ ] README includes `runs clear-running --job-id`.
- [ ] `npm test` passes.
- [ ] `npm run typecheck` passes.
- [ ] `git diff --check` passes.

## Notes
