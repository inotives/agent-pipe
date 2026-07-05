---
id: task-0011
title: "Phase 3: add runs visibility commands"
type: task
status: ready
assigned_to: worker
created_by: human
created_on: 2026-07-05
updated_on: 2026-07-05
priority: normal
parent: ""
depends_on:
  - task-0010
message: ""
---

# Task

## Context
Phase 3 adds read-only visibility over local run history stored in `job_runs`. The source of truth is `docs/phase-3-local-visibility-cli.md`.

## Goal
Implement `agent-pipe runs list` and `agent-pipe runs show <id>`.

## Scope
- Add `runs list`.
- Add `runs show <id>`.
- Keep commands read-only.
- Reuse existing project-root lookup, database path convention, and schema-version check.
- Follow the records visibility patterns introduced in `task-0010`.
- Do not add `jobs list`, job runner, scheduler, or new ingestion behavior.

## Planner Notes
- Use `runs`, not `jobs`, because Phase 3 exposes existing `job_runs` history before user-defined jobs exist.
- `runs list` defaults to compact table output with columns: `ID`, `JOB_ID`, `ENTITY`, `STATUS`, `RECORDS_WRITTEN`, `STARTED_AT`, `FINISHED_AT`.
- `runs list --json` returns the same compact fields as JSON.
- `runs list` defaults to `started_at desc` and limit `20`.
- Supported filters: `--status`, `--job-id`, `--limit`.
- `--status` is an exact string match against stored status.
- Empty table output prints only the header row.
- Empty JSON output is `[]`.
- `--limit` must be a positive integer.
- `runs show <id>` looks up the full stored `job_runs.id`.
- `runs show <id>` outputs pretty JSON only.
- Parse `metadata_json` as `metadata`.

## Implementation Plan
1. Add a small read-only runs query module.
2. Wire `runs list` and `runs show <id>` into the Commander CLI.
3. Add focused tests for list filters, JSON output, show output, empty results, invalid limit, and unknown ID.
4. Run targeted tests plus typecheck.

## Acceptance Criteria

- [ ] `npm run agent-pipe -- runs list` prints a compact table.
- [ ] `runs list --status`, `--job-id`, and `--limit` work.
- [ ] `runs list --json` prints JSON compact rows.
- [ ] Empty list output matches the Phase 3 doc.
- [ ] Invalid `--limit` fails clearly.
- [ ] `runs show <id>` prints pretty JSON with full error and parsed `metadata`.
- [ ] Unknown run ID fails clearly.
- [ ] `npm test` passes for the relevant runs tests.
- [ ] `npm run typecheck` passes.

## Notes
