---
id: task-0029
title: "Phase 6: add database filtering to records and runs"
type: task
status: ready
assigned_to: worker
created_by: human
created_on: 2026-07-06
updated_on: 2026-07-06
priority: normal
parent: ""
depends_on:
  - task-0028
message: "Add --database support to records and runs visibility commands so
  users can inspect non-default SQLite databases."
---

# Task

## Context
After ingestion can write to multiple databases, visibility commands need a way to inspect a selected database.

Source of truth: `docs/phase-6-runtime-hardening-multi-db.md`.

## Goal
Add `--database <name>` to records and runs commands.

## Scope
- Add `--database` to `records list`.
- Add `--database` to `records show`.
- Add `--database` to `runs list`.
- Add `--database` to `runs show`.
- Add `--database` to `runs clear-running`.
- Default all commands to `defaultDatabase`.
- Unknown database names fail clearly.
- Do not aggregate across all databases.

## Planner Notes
Keep list ordering and output fields the same as Phase 3/5. The only behavior change is which DB file is opened.

## Implementation Plan
1. Extend CLI options for records and runs commands.
2. Route read/write query helpers through the shared database resolver.
3. Add tests that default reads use `local`.
4. Add tests that `--database research` reads or updates `research`.
5. Add tests that data in one DB is not shown by another DB query.

## Acceptance Criteria

- [ ] `records list --database research` reads from `research`.
- [ ] `records show <id> --database research` reads from `research`.
- [ ] `runs list --database research` reads from `research`.
- [ ] `runs show <id> --database research` reads from `research`.
- [ ] `runs clear-running --database research` updates only `research`.
- [ ] Defaults still use `defaultDatabase`.
- [ ] Unknown database names fail clearly.
- [ ] `npm test` passes.
- [ ] `npm run typecheck` passes.
- [ ] `git diff --check` passes.

## Notes
