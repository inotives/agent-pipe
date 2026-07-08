---
id: task-0035
title: "Phase 7: add CSV file source ingestion"
type: task
status: done
assigned_to: worker
created_by: human
created_on: 2026-07-08
updated_on: 2026-07-08
priority: normal
parent: ""
depends_on:
  - task-0034
message: "Reviewer accepted: CSV file source ingestion, header validation,
  all-or-nothing writes, and csv-parse behavior match Phase 7 task 35."
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
- 2026-07-08 Fix: CSV header validation now requires the configured `idFields` to exist in the parsed header row, so headerless data-only CSV input fails immediately with the expected missing-header error instead of a later missing-id-field error.
- 2026-07-08 Fix: Added explicit regression coverage for a headerless CSV (`1,ok\n2,still-ok\n`) so this case cannot slip through review again.
- 2026-07-08 Reviewer finding: `src/source-run.ts` accepts a headerless CSV like `1,ok\n2,still-ok\n` because `csv-parse` with `columns: true` treats the first data row as headers. The run then fails later with `missing id field "id" for entity "notes"` instead of a clear missing-header error. This misses the task requirement that missing headers fail clearly.
- 2026-07-08 Reviewer finding: `tests/source-run.test.ts` covers blank-header and malformed CSV cases but does not cover a headerless data-only CSV, so the regression slips through.
- 2026-07-08: Added `csv-parse` as the Phase 7 CSV parser dependency instead of hand-rolling CSV parsing.
- 2026-07-08: Implemented `file.format: csv` ingestion through `source run`, preserving all cell values as strings and recording `rowNumber` metadata per record.
- 2026-07-08: Added coverage for repo sample CSV ingestion, quoted commas, multiline quoted values, malformed headers/content, and all-or-nothing failure when any row has an invalid id field.
- 2026-07-08: Verified with `npm test`, `npm run typecheck`, and `git diff --check`.
