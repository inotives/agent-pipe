---
id: task-0038
title: "Phase 7: add acceptance coverage and README updates"
type: task
status: done
assigned_to: worker
created_by: human
created_on: 2026-07-08
updated_on: 2026-07-08
priority: normal
parent: ""
depends_on:
  - task-0037
message: "Reviewer accepted: Phase 7 acceptance coverage and README file-source
  documentation match task 38."
---







# Task

## Context
Phase 7 needs one end-to-end user workflow that proves file sources work through the CLI and visibility commands.

Source of truth: `docs/phase-7-file-sources.md`.

## Goal
Add acceptance coverage and README documentation for JSON, CSV, and Markdown file sources.

## Scope
- Add acceptance coverage that initializes a project.
- Configure one JSON file source.
- Configure one CSV file source.
- Configure one Markdown file source.
- Run each source through `source run`.
- Verify records through `records list` and `records show`.
- Verify run history through `runs list`.
- Update README with file-source config examples and commands.

## Planner Notes
Keep tests deterministic. Do not add live external-network smoke for file sources.

## Implementation Plan
1. Add fixture files inside temp test projects.
2. Add Phase 7 acceptance flow.
3. Verify records and run history through CLI commands.
4. Update README with concise file-source usage.
5. Run required checks.

## Acceptance Criteria

- [ ] Acceptance test covers JSON file source ingestion.
- [ ] Acceptance test covers CSV file source ingestion.
- [ ] Acceptance test covers Markdown file source ingestion.
- [ ] Acceptance test verifies records visibility for file-source records.
- [ ] Acceptance test verifies run visibility for file-source runs.
- [ ] README documents `type: file`.
- [ ] README documents `file.format: json`, `csv`, and `markdown`.
- [ ] README documents project-root-relative `file.path`.
- [ ] `npm test` passes.
- [ ] `npm run typecheck` passes.
- [ ] `git diff --check` passes.

## Notes
- 2026-07-08: Added a Phase 7 acceptance test that initializes a temp project, configures one JSON file source, one CSV file source, and one Markdown file source, runs each via `source run`, and verifies records plus run visibility through the CLI.
- 2026-07-08: Updated `README.md` to document `type: file`, `file.format: json|csv|markdown`, project-root-relative `file.path`, and example `source run` commands for each file source.
- 2026-07-08: Verified with `npm test -- tests/acceptance.test.ts`, `npm run typecheck`, `npm test`, and `git diff --check`.
