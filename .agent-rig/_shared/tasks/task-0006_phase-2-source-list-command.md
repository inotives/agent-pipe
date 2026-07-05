---
id: task-0006
title: "Phase 2: add source list command"
type: task
status: done
assigned_to: worker
created_by: human
created_on: 2026-07-05
updated_on: 2026-07-05
priority: normal
parent: ""
depends_on:
  - task-0005
message: "Reviewed: source list now uses a real YAML parser, malformed
  sources.yaml repro is covered, and npm test plus npm run typecheck passed."
---













# Task

## Context
Projects define dynamic sources in `.agent-pipe/sources.yaml`. Users need a small discovery command before running a source.

## Goal
Add `agent-pipe source list` and `agent-pipe source list --json`.

## Scope
- Add a `source` command group to the CLI.
- Implement `source list` table output by default.
- Implement `source list --json` for automation.
- Print configured source ID, entity, and type.
- Do not deeply validate each source in `source list`.
- Show missing list fields as blank or `unknown`.
- Fail clearly when the project is not initialized or `sources.yaml` is missing/unparseable.

## Planner Notes
Do not add `source validate` in Phase 2. Full validation belongs to `source run`.

## Implementation Plan
1. Add a small source config reader for listing.
2. Wire the commander subcommand.
3. Cover table and JSON output in focused tests.

## Acceptance Criteria

- [ ] `npm run agent-pipe -- source list` prints a human-readable table.
- [ ] `npm run agent-pipe -- source list --json` prints valid JSON.
- [ ] Invalid unrelated source fields do not block listing.
- [ ] Missing source fields display as blank or `unknown`.
- [ ] `npm test` passes.
- [ ] `npm run typecheck` passes.

## Notes
- Reviewer return 2026-07-05: `source list` still does regex-based pseudo-parsing instead of real YAML parsing, so it does not reliably reject unparseable `sources.yaml`.
- Repro used in review:
  ```yaml
  sources:
    bad_source:
      entity: [broken
      type: api
  ```
- Current behavior: `source list --json` returns `[{"sourceId":"bad_source","entity":"[broken","type":"api"}]`.
- Expected behavior: fail clearly with `invalid .agent-pipe/sources.yaml`.
- Smallest fix: load `sources.yaml` with a real YAML parser, then derive the source summaries from the parsed object instead of line-by-line regex extraction.
