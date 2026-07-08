---
id: task-0035
title: "Phase 7: add CSV file source ingestion"
type: task
status: ready
assigned_to: worker
created_by: human
created_on: 2026-07-08
updated_on: 2026-07-08
priority: normal
parent: ""
depends_on:
  - task-0034
message: "Ready: add CSV file source ingestion using csv-parse while preserving cell values as strings."
---




# Task

## Context
Phase 7 supports CSV files as local source inputs after the JSON file-source path exists.

Source of truth: `docs/phase-7-file-sources.md`.

## Goal
Implement `file.format: csv` ingestion through `agent-pipe source run <sourceId>`.

## Scope
- Add `csv-parse` as the CSV parser dependency.
- Require a header row.
- Convert each CSV row into one payload object.
- Preserve every cell value as a string.
- Support quoted commas and multiline quoted values.
- Reject malformed CSV with a clear source-specific error.
- Validate all rows before writing.
- Store file metadata including `ingestionType`, `path`, `format`, and `rowNumber`.

## Planner Notes
Do not hand-roll CSV parsing. The dependency is intentional because correct CSV parsing is smaller than custom edge-case code.

## Implementation Plan
1. Add the minimal `csv-parse` dependency.
2. Implement CSV parsing for file sources.
3. Normalize rows into record payloads with string values.
4. Add tests for normal CSV, quoted commas, multiline quoted values, malformed CSV, and all-or-nothing failure.
5. Run required checks.

## Acceptance Criteria

- [ ] CSV file with headers writes one record per row.
- [ ] CSV quoted commas parse correctly.
- [ ] CSV multiline quoted values parse correctly.
- [ ] All CSV values are stored as strings.
- [ ] Missing or malformed headers fail clearly.
- [ ] Malformed CSV fails and records a failed run.
- [ ] Invalid ID field in any row writes no records.
- [ ] `npm test` passes.
- [ ] `npm run typecheck` passes.
- [ ] `git diff --check` passes.

## Notes
