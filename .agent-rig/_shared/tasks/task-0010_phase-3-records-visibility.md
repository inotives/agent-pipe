---
id: task-0010
title: "Phase 3: add records visibility commands"
type: task
status: ready
assigned_to: worker
created_by: human
created_on: 2026-07-05
updated_on: 2026-07-05
priority: normal
parent: ""
depends_on: []
message: ""
---

# Task

## Context
Phase 3 adds read-only visibility over the local SQLite datastore. The source of truth is `docs/phase-3-local-visibility-cli.md`.

## Goal
Implement `agent-pipe records list` and `agent-pipe records show <id>`.

## Scope
- Add `records list`.
- Add `records show <id>`.
- Keep commands read-only.
- Reuse existing project-root lookup, database path convention, and schema-version check.
- Follow existing CLI error behavior: clear stderr message and non-zero exit.
- Do not add job runner, scheduler, source execution changes, or new ingestion types.

## Planner Notes
- `records list` defaults to compact table output with columns: `ID`, `ENTITY`, `SOURCE`, `UPDATED_AT`.
- `records list --json` returns the same compact fields as JSON.
- `records list` defaults to `updated_at desc` and limit `20`.
- Supported filters: `--entity`, `--source`, `--limit`, `--include-deleted`.
- Hide `deleted_at is not null` records by default.
- Empty table output prints only the header row.
- Empty JSON output is `[]`.
- `--limit` must be a positive integer.
- `records show <id>` looks up the full stored `records.id`.
- `records show <id>` outputs pretty JSON only.
- `records show <id>` may return a soft-deleted record by exact ID.
- Parse `payload_json` as `payload` and `metadata_json` as `metadata`.

## Implementation Plan
1. Add a small read-only records query module.
2. Wire `records list` and `records show <id>` into the Commander CLI.
3. Add focused tests for list filters, JSON output, show output, empty results, invalid limit, and unknown ID.
4. Run targeted tests plus typecheck.

## Acceptance Criteria

- [ ] `npm run agent-pipe -- records list` prints a compact table.
- [ ] `records list --entity`, `--source`, `--limit`, and `--include-deleted` work.
- [ ] `records list --json` prints JSON compact rows.
- [ ] Empty list output matches the Phase 3 doc.
- [ ] Invalid `--limit` fails clearly.
- [ ] `records show <id>` prints pretty JSON with parsed `payload` and `metadata`.
- [ ] Unknown record ID fails clearly.
- [ ] `npm test` passes for the relevant records tests.
- [ ] `npm run typecheck` passes.

## Notes
