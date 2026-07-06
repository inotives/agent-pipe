---
id: task-0028
title: "Phase 6: route put, source run, and run job through databases"
type: task
status: ready
assigned_to: worker
created_by: human
created_on: 2026-07-06
updated_on: 2026-07-06
priority: normal
parent: ""
depends_on:
  - task-0027
message: "Wire record-writing commands through the configured database resolver,
  including source/job database fields and put --database."
---

# Task

## Context
The runtime can now resolve and bootstrap configured databases. Record-writing commands need to use it instead of hardcoded `.agent-pipe/data/local.sqlite`.

Source of truth: `docs/phase-6-runtime-hardening-multi-db.md`.

## Goal
Route `put`, `source run`, and `run --job` through configured databases.

## Scope
- Add optional `database` to source configs.
- Add optional `database` to job configs.
- Add `put --database <name>`.
- Missing database selection uses `defaultDatabase`.
- Unknown database references fail clearly.
- Source run history is stored in the selected source database.
- Job run history is stored in the selected job database.
- Runtime commands may bootstrap a selected missing database on first use.
- Do not add records/runs query routing yet.
- Do not change scheduler behavior yet.

## Planner Notes
Keep success output compatible unless adding `database` is necessary for tests. Do not invent cross-DB run aggregation.

## Implementation Plan
1. Extend source and job config schemas with optional `database`.
2. Add `--database` to `put`.
3. Replace hardcoded database paths in write commands with the shared resolver.
4. Ensure selected databases are bootstrapped before writes.
5. Add tests for source, job, and put writes into a second configured database.

## Acceptance Criteria

- [ ] `put --database research` writes records to `research`.
- [ ] `source run` writes records and run history to the source's configured database.
- [ ] `run --job` writes records and run history to the job's configured database.
- [ ] Missing database config defaults to `defaultDatabase`.
- [ ] Unknown database names fail clearly.
- [ ] First use of a configured missing DB bootstraps that DB.
- [ ] Existing single-DB behavior remains compatible.
- [ ] `npm test` passes.
- [ ] `npm run typecheck` passes.
- [ ] `git diff --check` passes.

## Notes
