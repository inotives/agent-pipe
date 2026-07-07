---
id: task-0032
title: "Phase 6: final verification and task cleanup"
type: task
status: done
assigned_to: worker
created_by: human
created_on: 2026-07-06
updated_on: 2026-07-07
priority: normal
parent: ""
depends_on:
  - task-0031
message: "Reviewer accepted: Phase 6 final verification, live repo-local db
  migration recovery, and fresh CoinGecko sampling verified."
---







# Task

## Context
Phase 6 should finish with implementation, docs, tests, README, and AgentRig task state aligned.

Source of truth: `docs/phase-6-runtime-hardening-multi-db.md`.

## Goal
Run the final Phase 6 verification pass and clean up task statuses/messages.

## Scope
- Verify implementation matches the Phase 6 doc.
- Verify README examples match implemented commands.
- Verify all Phase 6 task statuses and review messages are current.
- Confirm live smoke notes from Task 31 are present.
- Do not introduce new runtime behavior.

## Planner Notes
This is the final gate before committing Phase 6 implementation.

## Implementation Plan
1. Review Phase 6 commands against the phase doc.
2. Review README for stale planned wording.
3. Review Phase 6 task files for status/message drift.
4. Run the full check set.
5. Report any blocker clearly.

## Acceptance Criteria

- [ ] Phase 6 task files reflect the real final status.
- [ ] Phase 6 docs match implemented behavior.
- [ ] README matches implemented behavior.
- [ ] Task 31 live smoke notes are present.
- [ ] `npm test` passes.
- [ ] `npm run typecheck` passes.
- [ ] `git diff --check` passes.
- [ ] No known Phase 6 doc/implementation mismatch remains.

## Notes
- 2026-07-07 final Phase 6 verification pass reviewed the phase doc, README, acceptance coverage, and Phase 6 task headers/messages.
- Phase 6 task files `task-0025` through `task-0031` are already in `done` with current reviewer-accepted summary messages; no task status drift found.
- Task 31 live smoke notes are present and include both the initial sandbox-blocked `fetch failed` attempt and the approved successful CoinGecko runs for `local` and `research`.
- One documentation mismatch was corrected here: `docs/phase-6-runtime-hardening-multi-db.md` now uses `runs show <job-run-id>` to match README and the implemented CLI examples.
- No known remaining Phase 6 doc/implementation mismatch was found after the audit.
- Reviewer return:
  The repo-local final verification/sampling step exposed a real pre-release compatibility gap in the shipped runtime.
  Repro in the actual workspace:
  `node --import ./node_modules/tsx/dist/loader.mjs ./src/index.ts db init`
  failed against `.agent-pipe/data/local.sqlite` with literal error `no such column: source`.
  The current repo-local SQLite file still has a pre-Phase-6 shape:
  `records(entity, record_id, payload_json, created_at, updated_at)` and
  `job_runs(job_id, started_at, completed_at, status)` plus `schema_migrations(version)`.
  Two concrete issues follow:
  1. `src/runtime.ts:310-320` only replaces pre-release DBs when `schema_migrations` is missing, but this incompatible file already has `schema_migrations`, so it is treated as managed even though its table shape is obsolete.
  2. `src/runtime.ts:184-265` reports `db status` as `schemaStatus: "ok"` for this file because it only checks table presence and schema version, not required columns/index compatibility. In the same repo state, `db status` claimed `ok` while `db init` immediately failed.
  This blocks the requested repo-local sampling refresh for human review because the local DB cannot be safely reinitialized from the existing pre-release file.
- 2026-07-07 fix: `src/runtime.ts` now uses one shared managed-schema-shape check for both status inspection and pre-release replacement. Legacy files with `schema_migrations(version=1)` but pre-Phase-6 `records` / `job_runs` columns now report `schemaStatus: "incompatible_pre_release"` and are replaced during `db init`.
- Verified in the actual workspace: `node --import ./node_modules/tsx/dist/loader.mjs ./src/index.ts db status` first reported `incompatible_pre_release`, then `node --import ./node_modules/tsx/dist/loader.mjs ./src/index.ts db init` succeeded and returned `schemaStatus: "ok"` with all built-in indexes present.
- Final live verification after the fix:
  `node --import ./node_modules/tsx/dist/loader.mjs ./src/index.ts source run coingecko_coins_list`
  wrote `17319` rows with job run `4f191c2e-ae9c-4706-9cac-b536a1f442d0`, and
  `node --import ./node_modules/tsx/dist/loader.mjs ./src/index.ts source run coingecko_coin_history`
  wrote `1` row with job run `83e6b329-3694-44d2-9ac7-020145cdc221`.
- Repo-local `.agent-pipe/data/local.sqlite` now contains fresh human-reviewable Phase 6 data:
  `records=17320`, `job_runs=4`, `schema_migrations=1`;
  entity counts `coins_list=17319`, `coin_history=1`;
  latest successful runs are visible through `runs list` and `runs show`.
- Schema spot check against the live SQLite file confirms the expected Phase 6 columns are present:
  `records(id, project_id, entity, local_id, source, captured_at, payload_json, metadata_json, created_at, updated_at, deleted_at)`
  and
  `job_runs(id, job_id, entity, status, started_at, finished_at, records_written, error_message, metadata_json)`.
