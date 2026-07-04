---
id: task-0007
title: "Phase 2: implement API source runner"
type: task
status: ready
assigned_to: worker
created_by: human
created_on: 2026-07-05
updated_on: 2026-07-05
priority: normal
parent: ""
depends_on:
  - task-0005
message: ""
---

# Task

## Context
Phase 2 should prove the factory-style source model with API sources configured entirely in `.agent-pipe/sources.yaml`.

## Goal
Implement `agent-pipe source run <sourceId>` for `type: api` GET sources.

## Scope
- Validate only the selected source.
- Reject unsupported source types such as `file`, `stream`, and `graphql`.
- Support only API `GET`.
- Support `payloadPath: $` only.
- Accept a top-level array or top-level object response.
- For arrays, ingest one record per item.
- For objects, ingest one record.
- Resolve `${NAME}` placeholders from `.agent-pipe/.env.local` and process env.
- Fail clearly when a placeholder value is missing.
- Support path params in endpoints such as `/coins/{id}/history`.
- Support static query params from YAML.
- Support `pagination.type: none`.
- Support `pagination.type: page` with `pageParam`, `perPageParam`, `startPage`, `maxPages`, and `stopWhen: empty_page`.
- Require `maxPages` for page pagination.
- Support `rateLimit.minDelayMs` between paginated requests.
- Do not support `requestsPerMinute`.
- Do not retry failed HTTP requests.

## Planner Notes
Use Node's built-in `fetch`; do not add an HTTP dependency. Automated tests must use a local HTTP server, not CoinGecko.

## Implementation Plan
1. Parse and validate the selected source config with zod or existing validation style.
2. Build URLs from base URL, endpoint params, and query values.
3. Fetch pages until an empty page or `maxPages`.
4. Apply `minDelayMs` only between requests in the same run.
5. Return normalized records to the existing record-writing path.

## Acceptance Criteria

- [ ] `source run` supports the default `coingecko_coins_list` shape against a local test server.
- [ ] `source run` supports page pagination against a local test server.
- [ ] `source run` supports path and query params against a local test server.
- [ ] Unsupported source types fail clearly.
- [ ] Unsupported methods, payload paths, pagination shapes, and `requestsPerMinute` fail clearly.
- [ ] Missing env placeholders fail clearly.
- [ ] `npm test` passes.
- [ ] `npm run typecheck` passes.

## Notes

