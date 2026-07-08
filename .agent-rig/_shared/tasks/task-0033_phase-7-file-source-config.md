---
id: task-0033
title: "Phase 7: add file source config parsing"
type: task
status: done
assigned_to: worker
created_by: human
created_on: 2026-07-08
updated_on: 2026-07-08
priority: normal
parent: ""
depends_on: []
message: "Reviewer accepted: file source config parsing and selected-source
  validation match Phase 7 task 33."
---







# Task

## Context
Phase 7 adds local file ingestion as a second source type after API sources.

Source of truth: `docs/phase-7-file-sources.md`.

## Goal
Add `type: file` source config parsing and validation for JSON, CSV, and Markdown file sources.

## Scope
- Extend source config parsing to accept `type: file`.
- Add required `file.path`.
- Add required `file.format` with supported values `json`, `csv`, and `markdown`.
- Keep explicit `idFields` required for every file source.
- Preserve existing API source behavior and error messages where practical.
- Ensure unrelated invalid source configs do not block a selected valid source run.

## Planner Notes
This task should establish the YAML contract only. Do not implement file reading or record writes yet unless a tiny helper is needed for validation.

## Implementation Plan
1. Inspect the current source config parsing in `src/source-run.ts` and source list behavior.
2. Extend the schema/types for file sources.
3. Add validation errors for missing or unsupported file config.
4. Add focused tests for accepted and rejected file config shapes.
5. Run required checks.

## Acceptance Criteria

- [ ] `type: file` sources with `file.path` and valid `file.format` parse.
- [ ] Missing `file` config fails clearly for a selected file source.
- [ ] Missing `file.path` fails clearly for a selected file source.
- [ ] Unsupported `file.format` fails clearly for a selected file source.
- [ ] Missing `idFields` still fails clearly.
- [ ] Existing API source tests still pass.
- [ ] `npm test` passes.
- [ ] `npm run typecheck` passes.
- [ ] `git diff --check` passes.

## Notes
- 2026-07-08: Added selected-source parsing for `type: file` with required `file.path`, supported `file.format` values, and explicit `idFields` validation.
- 2026-07-08: Kept validation source-specific so unrelated invalid sibling sources still do not block the selected source.
- 2026-07-08: Verified with `npm test`, `npm run typecheck`, and `git diff --check`.
