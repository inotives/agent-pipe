---
id: task-0022
title: "Phase 5: add runs clear-running --job-id"
type: task
status: ready
assigned_to: worker
created_by: human
created_on: 2026-07-06
updated_on: 2026-07-06
priority: normal
parent: ""
depends_on:
  - task-0021
message: ""
---

# Task

## Context
Phase 5 keeps stale-running cleanup explicit. Operators need a targeted recovery command for one stuck job.

Source of truth: `docs/phase-5-local-scheduler.md`.

## Goal
Add `agent-pipe runs clear-running --job-id <jobId>`.

## Scope
- Add a `runs clear-running` subcommand.
- Require `--job-id <jobId>`.
- Update only matching rows where `job_id = <jobId>` and `status = running`.
- Mark cleared rows as failed.
- Set `finished_at` to current time.
- Set `error_message` to `cleared running job by operator`.
- Print compact JSON with `{ jobId, cleared }`.
- Add focused tests.

## Planner Notes
This command is intentionally targeted. Do not add an all-jobs clear command unless a later phase asks for it.

## Implementation Plan
1. Add a small write helper near the runs query module or runtime helpers.
2. Wire `runs clear-running --job-id` into the CLI.
3. Return the number of rows updated.
4. Add tests for clearing matching rows, leaving other jobs untouched, and zero-row success.

## Acceptance Criteria

- [ ] `agent-pipe runs clear-running --job-id <jobId>` exists.
- [ ] Matching `running` rows become `failed`.
- [ ] Non-running rows are untouched.
- [ ] Other jobs are untouched.
- [ ] Cleared rows get `finished_at`.
- [ ] Cleared rows get `error_message = "cleared running job by operator"`.
- [ ] Command succeeds with `cleared: 0` when no rows match.
- [ ] `npm test` passes.
- [ ] `npm run typecheck` passes.

## Notes
