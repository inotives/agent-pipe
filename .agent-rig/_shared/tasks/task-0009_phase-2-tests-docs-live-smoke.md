---
id: task-0009
title: "Phase 2: add acceptance tests, docs, and live smoke"
type: task
status: ready
assigned_to: worker
created_by: human
created_on: 2026-07-05
updated_on: 2026-07-05
priority: normal
parent: ""
depends_on:
  - task-0006
  - task-0008
message: ""
---

# Task

## Context
Phase 2 needs deterministic tests plus one final live CoinGecko smoke to prove the default source config works outside the test server.

## Goal
Finish Phase 2 acceptance coverage, README updates, and live smoke verification.

## Scope
- Add acceptance tests for init, source list, source run, pagination, path/query params, rate limiting, env placeholders, and failure persistence.
- Use a local HTTP server in automated tests.
- Do not call live CoinGecko from routine automated tests.
- Update README quickstart with:
  - `npm run agent-pipe -- init`
  - `npm run agent-pipe -- source list`
  - `npm run agent-pipe -- source run coingecko_coins_list`
- Run a final live smoke against CoinGecko using the default `coingecko_coins_list` source.
- Verify `npm test` and `npm run typecheck`.

## Planner Notes
The live smoke is a final manual verification step, not part of the default test suite. Default CoinGecko sources should work without requiring `COINGECKO_API_KEY`.

## Implementation Plan
1. Add missing acceptance tests around the final Phase 2 workflow.
2. Update README with the shortest useful source-ingestion quickstart.
3. Run local tests and typecheck.
4. Run one live `coingecko_coins_list` smoke and inspect JSON output plus SQLite status.

## Acceptance Criteria

- [ ] Automated tests use only local HTTP servers for API behavior.
- [ ] README documents `source list` and `source run`.
- [ ] `npm test` passes.
- [ ] `npm run typecheck` passes.
- [ ] Live `coingecko_coins_list` smoke succeeds or documents a concrete external API/network failure.
- [ ] The repo is clean except intended Phase 2 changes after verification.

## Notes

