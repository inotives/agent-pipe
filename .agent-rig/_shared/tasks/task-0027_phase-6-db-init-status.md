---
id: task-0027
title: "Phase 6: add db init and db status"
type: task
status: ready
assigned_to: worker
created_by: human
created_on: 2026-07-06
updated_on: 2026-07-06
priority: normal
parent: ""
depends_on:
  - task-0026
message: "Add operator-facing database maintenance commands for preparing and
  inspecting all configured SQLite databases."
---

# Task

## Context
After users edit `project.yaml` to add a second database, they should not rerun project init. Phase 6 adds `db init` and `db status` for that flow.

Source of truth: `docs/phase-6-runtime-hardening-multi-db.md`.

## Goal
Add `agent-pipe db init` and `agent-pipe db status`.

## Scope
- Add `db init`.
- Add `db status`.
- `db init` prepares all configured databases.
- `db init` is safe to rerun.
- `db status` reports all configured databases as JSON.
- Include schema, table, and built-in index health in status output.
- Do not add `--database` to records/runs yet.
- Do not route ingestion commands yet.

## Planner Notes
Keep output JSON-first for automation. A pretty table can wait.

## Implementation Plan
1. Add a `db` command group in the CLI.
2. Implement `db init` using the shared bootstrap.
3. Implement `db status` using read-only inspection where possible.
4. Cover missing, healthy, and incompatible DB status cases.
5. Update CLI command registration tests.

## Acceptance Criteria

- [ ] `db init` creates missing configured SQLite files.
- [ ] `db init` creates schema and indexes.
- [ ] `db init` succeeds when run repeatedly.
- [ ] `db status` prints JSON.
- [ ] `db status` includes database name, configured path, absolute path, existence, schema status, table health, and index status.
- [ ] Missing or invalid `.agent-pipe/project.yaml` fails clearly.
- [ ] README mentions `db init` and `db status`.
- [ ] `npm test` passes.
- [ ] `npm run typecheck` passes.
- [ ] `git diff --check` passes.

## Notes
