---
id: task-0016
title: "Phase 4: add run --job failure, env, timeout, and lock behavior"
type: task
status: done
assigned_to: worker
created_by: human
created_on: 2026-07-05
updated_on: 2026-07-05
priority: normal
parent: ""
depends_on:
  - task-0015
message: Completed run --job failure semantics, env loading, timeout handling,
  same-job lock, and focused tests.
---







# Task

## Context
After the success path exists, Phase 4 needs the configured failure semantics from `docs/phase-4-manual-job-runner.md`.

## Goal
Finish `run --job` runtime behavior for failures, environment loading, timeout, and same-job locking.

## Scope
- Load `.agent-pipe/.env.local` into child command environment.
- Preserve process environment precedence over `.env.local`.
- Add default timeout `60000`.
- Support optional per-job `timeoutMs`.
- Validate `timeoutMs` as a positive integer.
- Fail runs for command failure, timeout, invalid stdout JSON, missing id fields, unknown job/entity, invalid job config, and database errors.
- Add same-job lock based on existing `job_runs.status = running`.
- Create a `skipped` run row for same-job lock conflicts.
- Cap stderr/error snippets in `job_runs.error_message` at 1000 characters.

## Planner Notes
- Child env precedence:
  1. Current process environment.
  2. `.agent-pipe/.env.local` for keys not already set in process env.
- Parse `.env.local` with the same simple `KEY=value` behavior used by source execution.
- Do not store full stdout or stderr in metadata.
- Same-job lock only blocks the same `job_id`; unrelated jobs are not blocked.

## Implementation Plan
1. Add `.env.local` loading to the child command env.
2. Add timeout handling and validation.
3. Wrap run execution so all configured failures update the job row to `failed`.
4. Add same-job running detection and skipped row creation.
5. Add focused tests for each failure mode and env behavior.

## Acceptance Criteria

- [ ] `.agent-pipe/.env.local` values are available to child commands.
- [ ] Process env values override `.env.local` values.
- [ ] Missing or invalid `timeoutMs` behavior matches the Phase 4 doc.
- [ ] Non-zero command exit creates a `failed` run.
- [ ] Timeout creates a `failed` run.
- [ ] Invalid stdout JSON creates a `failed` run.
- [ ] Unknown job fails clearly.
- [ ] Unknown entity fails clearly.
- [ ] Missing or invalid id fields fail clearly.
- [ ] Same-job running lock creates a `skipped` run row.
- [ ] Error snippets are capped at 1000 characters.
- [ ] `npm test` passes for relevant failure/env/lock tests.
- [ ] `npm run typecheck` passes.

## Notes
- Reviewer return 2026-07-05:
  - `src/job-run.ts:51-60` loads schedules and resolves `schedules.jobs[options.jobId]` before opening the database or inserting any `job_runs` row.
  - That means pre-execution failures like unknown job and invalid job config/unknown entity return an error but leave no run-history row at all. I verified this with an isolated temp project: `agent-pipe run --job missing_job` failed, and `agent-pipe runs list --json` still returned `[]`.
  - This misses the Phase 4 contract that `run --job` writes a `job_runs` row for every attempted run and that unknown/invalid config failures are represented as `failed`.
  - Fix expectation: insert a failed run row for pre-execution job lookup/config errors too, and add focused coverage that asserts the `job_runs` row exists with `status = failed` for at least unknown job and invalid job config.
