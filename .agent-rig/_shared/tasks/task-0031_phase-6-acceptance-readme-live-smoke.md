---
id: task-0031
title: "Phase 6: add acceptance coverage, README updates, and live smoke notes"
type: task
status: ready
assigned_to: worker
created_by: human
created_on: 2026-07-06
updated_on: 2026-07-06
priority: normal
parent: ""
depends_on:
  - task-0030
message: "Add end-to-end multi-DB acceptance coverage, update README for the
  implemented Phase 6 behavior, and run the CoinGecko live smoke when possible."
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
