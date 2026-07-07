---
id: task-0031
title: "Phase 6: add acceptance coverage, README updates, and live smoke notes"
type: task
status: done
assigned_to: worker
created_by: human
created_on: 2026-07-06
updated_on: 2026-07-07
priority: normal
parent: ""
depends_on:
  - task-0030
message: "Reviewer accepted: Phase 6 now has deterministic end-to-end multi-db
  acceptance coverage, README documents implemented multi-db behavior and
  commands, and live CoinGecko smoke notes are recorded in the task notes for
  both default and research databases. npm test/typecheck/diff-check passed."
---




# Task

## Context
Phase 6 needs one end-to-end path proving config, bootstrap, ingestion, visibility, and status work together.

Source of truth: `docs/phase-6-runtime-hardening-multi-db.md`.

## Goal
Add final Phase 6 acceptance coverage and update user-facing docs.

## Scope
- Add acceptance coverage for a project with `local` and `research` databases.
- Verify `db init` and `db status`.
- Verify writes into both DBs.
- Verify records and runs visibility with `--database`.
- Update README so Phase 6 behavior is no longer marked planned once implemented.
- Run a live CoinGecko smoke for default DB and second DB when network access is available.
- Record live smoke notes in this task's `Notes`.

## Planner Notes
Automated tests should stay deterministic and avoid external network. The live CoinGecko smoke belongs in the worker/reviewer notes, not routine `npm test`.

## Implementation Plan
1. Add deterministic acceptance tests using local files/jobs or local HTTP.
2. Cover `db init`, `db status`, multi-DB writes, records visibility, and runs visibility.
3. Update README commands and examples for implemented Phase 6.
4. Run required checks.
5. Run the CoinGecko smoke outside normal tests if network access allows.
6. Add concise live smoke results to `## Notes`.

## Acceptance Criteria

- [ ] Acceptance test covers `local` plus `research` database config.
- [ ] Acceptance test verifies `db init`.
- [ ] Acceptance test verifies `db status`.
- [ ] Acceptance test verifies records written into both DB files.
- [ ] Acceptance test verifies run history beside records in the selected DB.
- [ ] README documents implemented multi-DB behavior.
- [ ] CoinGecko smoke into default DB is attempted and documented.
- [ ] CoinGecko smoke into second DB is attempted and documented.
- [ ] `npm test` passes.
- [ ] `npm run typecheck` passes.
- [ ] `git diff --check` passes.

## Notes
- 2026-07-07 live CoinGecko smoke run in `/private/tmp/agent-pipe-task31.nIB8F7`.
- First default-db attempt inside the sandbox failed with literal error `fetch failed`; reran with network approval for live validation.
- `source run coingecko_coins_list` succeeded in `local`: `recordsWritten=17345`, `jobRunId=e9f4fdbb-bf48-4225-91e8-a17321acd8c7`.
- `source run coingecko_coins_markets` was configured with `database: research` and succeeded in `research`: `recordsWritten=500`, `jobRunId=38b24ad1-1cc2-43b1-83a1-4659ee3ee951`.
- Post-run counts from the SQLite files: `local.records=17345`, `local.runs=2` (one sandbox-blocked failed run plus one succeeded live run), `research.records=500`, `research.runs=1`.
- `db status` reported `schemaStatus=ok` with all managed tables and built-in indexes present for both `local` and `research`.
