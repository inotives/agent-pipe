---
id: task-0004
title: "Phase 1: add acceptance tests"
type: task
status: todo
assigned_to: "worker"
created_by: human
created_on: 2026-07-04
updated_on: 2026-07-04
priority: normal
parent: ""
depends_on: [task-0003]
---

# Task

## Context
Phase 1 should leave behind the smallest useful regression net for CLI init and put behavior. Use `docs/phase-1-project-skeleton.md` as the source of truth for Phase 1 decisions.

## Goal
Add focused acceptance tests for the complete Phase 1 workflow.

## Scope
- Exercise `init` in a temporary project directory.
- Exercise `put` with a `coins_list` fixture shaped like CoinGecko `/coins/list` output.
- Create fixture files in temporary directories.
- Verify idempotent reruns.
- Verify missing id fields fail clearly.
- Verify project ID participates in record identity.
- Call the CLI through child processes for the acceptance path.
- Update README with a short Phase 1 quickstart.
- Include a tiny two-record `coins.json` example in README.

## Planner Notes
Use Vitest. Do not add coverage thresholds in Phase 1.

## Implementation Plan
1. Add compact in-test fixtures for `coins_list`.
2. Test the CLI through child processes using the same npm/local entrypoint shape used by developers.
3. Inspect SQLite directly for row counts and IDs.

## Acceptance Criteria

- [ ] Default `npm test` covers the Phase 1 acceptance signals.
- [ ] `npm run typecheck` passes.
- [ ] Tests do not require network access or Postgres.
- [ ] Tests use temporary directories and leave the repo clean.
- [ ] README shows `init`, `put`, `npm test`, and `npm run typecheck`.
- [ ] README includes a two-record `coins.json` example.

## Notes
