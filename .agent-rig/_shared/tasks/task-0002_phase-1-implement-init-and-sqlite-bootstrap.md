---
id: task-0002
title: "Phase 1: implement init and SQLite bootstrap"
type: task
status: todo
assigned_to: "worker"
created_by: human
created_on: 2026-07-04
updated_on: 2026-07-04
priority: normal
parent: ""
depends_on: [task-0001]
---

# Task

## Context
Build on the CLI skeleton from task-0001. This task creates the local Agent Pipe folder and SQLite schema. Use `docs/phase-1-project-skeleton.md` as the source of truth for Phase 1 decisions.

## Goal
Implement `agent-pipe init` with deterministic local folder and database bootstrap.

## Scope
- Create `.agent-pipe/project.yaml` when missing.
- Default `projectId` by lowercasing the folder name and normalizing common separators to hyphens.
- Validate `projectId` with `^[a-z0-9_-]+$`.
- Default `projectName` to a humanized version of `projectId`.
- Support `--project-name` override.
- Print compact JSON to stdout on success.
- Use project-relative paths in success output.
- Print human-readable errors to stderr and exit non-zero.
- Create `.agent-pipe/schedules.yaml` when missing, with `coins_list` configured as `idFields: [id]` and no jobs.
- Create `.agent-pipe/data/local.sqlite`.
- Create `.agent-pipe/logs/`.
- Create `records`, `job_runs`, and `schema_migrations` tables.
- Record schema version `1`.
- Fail clearly on unsupported existing schema versions.
- Enable SQLite WAL mode.
- Leave existing config files untouched.
- Use `better-sqlite3` for database bootstrap.
- Fail clearly if a parent directory already contains `.agent-pipe/`.

## Planner Notes
Keep init rerunnable. Do not overwrite user-edited config files.

## Implementation Plan
1. Resolve the init project root from the current working directory and reject nested projects.
2. Create missing folders/files.
3. Open SQLite and apply `create table if not exists` schema.
4. Cover rerun behavior with a small test.

## Acceptance Criteria

- [ ] `npm run agent-pipe -- init` creates the expected `.agent-pipe/` tree.
- [ ] Re-running `init` succeeds without clobbering existing config.
- [ ] SQLite contains `records`, `job_runs`, and `schema_migrations`.
- [ ] Unsupported existing schema versions fail clearly.
- [ ] `npm test` passes.

## Notes
