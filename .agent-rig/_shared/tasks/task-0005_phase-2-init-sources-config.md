---
id: task-0005
title: "Phase 2: initialize declarative source config"
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
Phase 2 adds project-specific `sources.yaml` so projects can define their own ingestion sources. Use `docs/phase-2-declarative-sources.md` as the source of truth.

## Goal
Extend `agent-pipe init` so new projects include the default source configuration and local credential file.

## Scope
- Create `.agent-pipe/sources.yaml` when missing.
- Seed `coingecko_coins_list`, `coingecko_coins_markets`, and `coingecko_coin_history`.
- Keep `coingecko_coins_list` as the quick smoke source.
- Include page pagination config for `coingecko_coins_markets`.
- Include path/query params for `coingecko_coin_history`.
- Use `rateLimit.minDelayMs: 10000` in default CoinGecko sources.
- Create `.agent-pipe/.env.local` when missing.
- Leave existing `.agent-pipe/sources.yaml` and `.agent-pipe/.env.local` untouched on rerun.
- Do not require a CoinGecko API key in default sources.

## Planner Notes
Keep this task limited to init/config creation. Do not implement source execution here.

## Implementation Plan
1. Add the default `sources.yaml` content near the existing init defaults.
2. Extend init tests to assert file creation and rerun no-clobber behavior.
3. Keep `.agent-pipe/` ignored; do not add a committed local env file.

## Acceptance Criteria

- [ ] `npm run agent-pipe -- init` creates `.agent-pipe/sources.yaml`.
- [ ] `npm run agent-pipe -- init` creates `.agent-pipe/.env.local`.
- [ ] Re-running init does not overwrite existing source config or env content.
- [ ] Default source config matches `docs/phase-2-declarative-sources.md`.
- [ ] `npm test` passes.
- [ ] `npm run typecheck` passes.

## Notes

