---
id: task-0034
title: "Phase 7: implement JSON file source ingestion"
type: task
status: ready
assigned_to: worker
created_by: human
created_on: 2026-07-08
updated_on: 2026-07-08
priority: normal
parent: ""
depends_on:
  - task-0033
message: "Ready: implement JSON file source ingestion through source run with all-or-nothing writes."
---




# Task

## Context
After file source config exists, Phase 7 needs the first working file format.

Source of truth: `docs/phase-7-file-sources.md`.

## Goal
Implement `file.format: json` ingestion through `agent-pipe source run <sourceId>`.

## Scope
- Read `file.path` relative to the project root.
- Reject absolute paths and paths escaping the project root.
- Accept a top-level JSON object as one record payload.
- Accept a top-level JSON array of objects as many record payloads.
- Reject primitive top-level JSON and arrays containing non-object items.
- Validate all payloads before writing.
- Reuse existing record building, upsert, database routing, and run history.
- Store file metadata including `ingestionType`, `path`, `format`, and `itemIndex` for array items.

## Planner Notes
JSON should prove the full file-source write path before CSV and Markdown add format-specific parsing.

## Implementation Plan
1. Add a file-source execution branch for `format: json`.
2. Add safe project-root-relative path resolution.
3. Parse and normalize JSON payloads.
4. Validate all records before upserting.
5. Add tests for object, array, invalid shape, path safety, and run history.
6. Run required checks.

## Acceptance Criteria

- [ ] JSON object file writes one record.
- [ ] JSON array file writes one record per object.
- [ ] Invalid JSON fails and records a failed run.
- [ ] Primitive JSON fails and writes no records.
- [ ] Array with a non-object item fails and writes no records.
- [ ] Absolute file paths are rejected.
- [ ] Escaping relative paths are rejected.
- [ ] Successful JSON runs write `job_runs` history beside the selected database.
- [ ] `npm test` passes.
- [ ] `npm run typecheck` passes.
- [ ] `git diff --check` passes.

## Notes
