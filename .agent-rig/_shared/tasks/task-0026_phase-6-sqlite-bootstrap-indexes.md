---
id: task-0026
title: "Phase 6: centralize SQLite bootstrap and built-in indexes"
type: task
status: done
assigned_to: worker
created_by: human
created_on: 2026-07-06
updated_on: 2026-07-07
priority: normal
parent: ""
depends_on:
  - task-0025
message: "Reviewer accepted: shared SQLite bootstrap/resolution path creates
  managed schema plus built-in indexes, replaces incompatible pre-release files,
  preserves unsupported-schema rejection, and the init rerun path now reports
  the bootstrapped configured database correctly. npm test/typecheck/diff-check
  passed."
---







# Task

## Context
Phase 6 needs one database opening path before commands can route to multiple SQLite files.

Source of truth: `docs/phase-6-runtime-hardening-multi-db.md`.

## Goal
Centralize SQLite database resolution/bootstrap and create built-in indexes for every managed database.

## Scope
- Add a shared helper for resolving configured database names to absolute SQLite paths.
- Add a shared bootstrap path for creating tables, schema version, WAL, and indexes.
- Add built-in indexes listed in the Phase 6 doc.
- Allow incompatible pre-release SQLite files to be replaced directly.
- Keep bootstrap idempotent.
- Do not add `db init` or `db status` commands yet.
- Do not update ingestion command routing yet.

## Planner Notes
This task should remove hardcoded assumptions from shared runtime helpers where practical, but command-specific wiring can wait for later tasks.

## Implementation Plan
1. Move or wrap existing SQLite bootstrap into a reusable database runtime module.
2. Add index creation with stable names.
3. Detect incompatible pre-release schema files and replace them directly.
4. Add tests that bootstrap multiple configured databases.
5. Add tests that repeated bootstrap does not fail or duplicate state.

## Acceptance Criteria

- [ ] Shared bootstrap creates `records`, `job_runs`, and `schema_migrations`.
- [ ] Shared bootstrap creates all built-in indexes from the Phase 6 doc.
- [ ] Shared bootstrap is idempotent.
- [ ] Multiple configured SQLite DBs can be bootstrapped in one project.
- [ ] An incompatible pre-release DB file can be replaced.
- [ ] Existing schema version checks still reject genuinely unsupported managed schemas clearly.
- [ ] `npm test` passes.
- [ ] `npm run typecheck` passes.
- [ ] `git diff --check` passes.

## Notes
- Reviewer return:
  `src/init.ts:130-140` now bootstraps the configured default database on rerun, but `init` still reports `.agent-pipe/data/local.sqlite` in its JSON result unconditionally. Repro:
  create an existing `.agent-pipe/project.yaml` with `defaultDatabase: research` and `databases.research.path: data/research.sqlite`, then run `agent-pipe init` again. The command succeeds, creates `data/research.sqlite`, leaves `data/local.sqlite` missing, and still returns `"database": ".agent-pipe/data/local.sqlite"`.
  This is now a user-visible lie in `init` output and a rerun behavior regression introduced by the shared bootstrap switch. Fix by keeping the bootstrapped path and reported path aligned on rerun.
