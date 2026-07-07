---
id: task-0025
title: "Phase 6: add project database config parsing"
type: task
status: done
assigned_to: worker
created_by: human
created_on: 2026-07-06
updated_on: 2026-07-06
priority: normal
parent: ""
depends_on: null
message: "Reviewer accepted: project.yaml now parses Phase 6 database config,
  init writes the new default local sqlite shape, runtime coverage added, and
  npm test/typecheck/diff-check passed."
---




# Task

## Context
Phase 6 adds multi-DB SQLite support. The first step is making `.agent-pipe/project.yaml` the source of truth for database names and paths.

Source of truth: `docs/phase-6-runtime-hardening-multi-db.md`.

## Goal
Add project database config parsing and update new project init output.

## Scope
- Extend project config loading to read `defaultDatabase` and `databases`.
- Keep `local` as the default database.
- Support only `type: sqlite`.
- Require configured paths to resolve under `.agent-pipe/data/`.
- Update `agent-pipe init` to write the new `project.yaml` shape for new projects.
- Preserve current rerunnable init behavior for existing config files.
- Do not add database CLI commands in this task.
- Do not route ingestion commands yet.

## Planner Notes
Keep this as config and init only. Later tasks will consume the parsed database config.

## Implementation Plan
1. Add a project database config parser with zod validation.
2. Add defaulting or compatibility handling needed for existing Phase 5 config in tests.
3. Update init's default `project.yaml` content.
4. Update init tests to assert the new config shape.
5. Add parser tests for valid config, unknown database default, unsupported type, and unsafe paths.

## Acceptance Criteria

- [ ] New init writes `defaultDatabase: local`.
- [ ] New init writes `databases.local.type: sqlite`.
- [ ] New init writes `databases.local.path: data/local.sqlite`.
- [ ] Database paths outside `.agent-pipe/data/` fail clearly.
- [ ] Unsupported database types fail clearly.
- [ ] Existing rerunnable init behavior remains intact.
- [ ] `npm test` passes.
- [ ] `npm run typecheck` passes.
- [ ] `git diff --check` passes.

## Notes
