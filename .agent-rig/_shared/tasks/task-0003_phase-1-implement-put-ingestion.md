---
id: task-0003
title: "Phase 1: implement put ingestion"
type: task
status: todo
assigned_to: "worker"
created_by: human
created_on: 2026-07-04
updated_on: 2026-07-04
priority: normal
parent: ""
depends_on: [task-0002]
---

# Task

## Context
Build on the initialized project folder and SQLite schema from task-0002. Use `docs/phase-1-project-skeleton.md` as the source of truth for Phase 1 decisions.

## Goal
Implement deterministic `agent-pipe put --entity <entity> --file <json>` ingestion.

## Scope
- Read `projectId` from `.agent-pipe/project.yaml`.
- Read entity `idFields` from `.agent-pipe/schedules.yaml`.
- Validate entity names with `^[a-z0-9_-]+$`.
- Find the project root by walking upward to the nearest `.agent-pipe/`.
- Use `zod` for config and input validation.
- Fail clearly if `.agent-pipe/` or required config files are missing.
- Fail clearly if the SQLite schema version is unsupported.
- Accept a JSON file path containing records.
- Resolve relative input file paths from the current working directory.
- Do not support stdin input in Phase 1.
- Build `local_id` from configured `idFields`.
- Encode `local_id` as the JSON tuple of configured `idFields` values.
- Preserve native JSON value types in the `local_id` tuple.
- Treat `idFields` as top-level payload fields only.
- Reject object and array values in `idFields`.
- Store rows in `records` with `id = <projectId>:<entity>:<localId>`.
- Store timestamps as ISO 8601 UTC strings.
- Set `deleted_at` to null for active records.
- Upsert records so reruns are idempotent.
- Preserve `created_at` on upsert, update `updated_at`, and set `deleted_at` back to null.
- Fail clearly when an id field is missing.
- Reject only null, missing, and empty-string id field values; allow `0` and `false`.
- Fail clearly and list configured entities when `--entity` is unknown.
- Do not validate payload fields beyond configured `idFields`.
- Store `payload_json` and `metadata_json` as compact JSON.
- Do not sort payload keys before storing.
- Validate all records before writing, then write in one transaction.
- Do not add an explicit app-level write lock in Phase 1.
- Allow duplicate IDs inside one input file; the last item wins.
- Set `source` to `file`.
- Store minimal `metadata_json` with `inputFile`.
- Print compact JSON to stdout with `projectId`, `entity`, and `recordsWritten`, where `recordsWritten` counts accepted input records.
- Do not include the database path in `put` success output.
- Do not include `recordsFailed` in success output.
- Print human-readable errors to stderr and exit non-zero.

## Planner Notes
Use the generic `records` table only. Do not create per-entity tables. Do not write `job_runs` from `put`.

## Implementation Plan
1. Load and validate project/schedule config.
2. Parse the input JSON file.
3. Convert each item to a record row.
4. Validate every row before writing.
5. Upsert rows inside one SQLite transaction.
6. Print a compact JSON result summary.

## Acceptance Criteria

- [ ] `put` writes deterministic record IDs.
- [ ] Re-running `put` with the same file does not duplicate rows.
- [ ] Missing `idFields` values fail with a clear message.
- [ ] Unknown entities fail with a clear message listing configured entities.
- [ ] Invalid `idFields` values reject null, missing, empty string, objects, and arrays while allowing `0` and `false`.
- [ ] Same entity/local id under different `projectId` values produces different record IDs.
- [ ] `npm test` passes.

## Notes
