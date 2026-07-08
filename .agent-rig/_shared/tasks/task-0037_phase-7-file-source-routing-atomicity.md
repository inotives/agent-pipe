---
id: task-0037
title: "Phase 7: harden file source routing and atomicity"
type: task
status: done
assigned_to: worker
created_by: human
created_on: 2026-07-08
updated_on: 2026-07-08
priority: normal
parent: ""
depends_on:
  - task-0036
message: "Reviewer accepted: file source atomicity, default/non-default database
  routing, and unknown-database failures match Phase 7 task 37."
---







# Task

## Context
After JSON, CSV, and Markdown file ingestion exist, Phase 7 needs the cross-format safety guarantees verified.

Source of truth: `docs/phase-7-file-sources.md`.

## Goal
Ensure file sources are all-or-nothing and honor Phase 6 database routing for every supported format.

## Scope
- Confirm parse and ID validation happen before any file-source records are written.
- Confirm failures leave no partial records for JSON, CSV, or Markdown sources.
- Confirm file sources write records and run history to the selected configured database.
- Confirm omitted `database` uses `defaultDatabase`.
- Confirm unknown configured databases fail clearly for file sources.
- Keep API source behavior unchanged.

## Planner Notes
This task may mostly add tests and small refactors. Avoid broad abstractions unless they remove obvious duplication from the file-source implementation.

## Implementation Plan
1. Review file-source write order for all formats.
2. Add or tighten all-or-nothing tests.
3. Add multi-DB routing tests for file sources.
4. Add unknown database failure tests for file sources.
5. Run required checks.

## Acceptance Criteria

- [ ] A file source with one invalid row writes no records.
- [ ] Failed file runs still record failed `job_runs` history.
- [ ] File sources write records to the configured non-default database.
- [ ] File source run history is stored in the same selected database.
- [ ] File sources default to `defaultDatabase` when `database` is omitted.
- [ ] Unknown file-source database references fail clearly.
- [ ] Existing API database-routing tests still pass.
- [ ] `npm test` passes.
- [ ] `npm run typecheck` passes.
- [ ] `git diff --check` passes.

## Notes
- 2026-07-08: Verified the shared file-source flow stays all-or-nothing by parsing and validating payloads before any `upsertRecords` call for JSON, CSV, and Markdown sources.
- 2026-07-08: Added cross-format routing coverage proving JSON, CSV, and Markdown file sources write both records and `job_runs` history to the configured non-default database instead of the default database.
- 2026-07-08: Added cross-format unknown-database coverage proving file sources fail clearly before any write when `database` references a missing configured database.
- 2026-07-08: Verified with `npm test -- tests/source-run.test.ts`, `npm run typecheck`, `npm test`, and `git diff --check`.
