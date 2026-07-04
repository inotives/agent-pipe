# Phase 2 - Declarative Sources

## Goal

Add project-specific `sources.yaml` support so Agent Pipe can run configured sources and write records through the existing local record store.

## Decisions

- Phase 2 implements declarative source ingestion, not the scheduler or arbitrary shell job runner.
- Phase 2 adds `agent-pipe source run <sourceId>`.
- Phase 2 adds `agent-pipe source list`.
- `agent-pipe source list` prints configured source IDs with entity and type.
- `agent-pipe source list` prints a table by default.
- `agent-pipe source list --json` prints JSON for automation.
- `agent-pipe source list` does not deeply validate source configs.
- Missing list fields may display as blank or `unknown`.
- Phase 2 does not add `agent-pipe source validate`.
- `.agent-pipe/sources.yaml` defines source-owned entity identity and ingestion details.
- `agent-pipe init` creates a default `.agent-pipe/sources.yaml`.
- The default `sources.yaml` includes `coingecko_coins_list`, `coingecko_coins_markets`, and `coingecko_coin_history`.
- `coingecko_coins_list` is the default quick smoke source.
- `coingecko_coins_markets` proves page-based pagination.
- `coingecko_coin_history` proves path and query params.
- `agent-pipe init` creates `.agent-pipe/.env.local` for local source credentials.
- `.agent-pipe/.env.local` is not committed and is loaded by source execution when present.
- `sources.yaml` may reference credentials with `${NAME}` placeholders.
- Placeholder values are read from `.agent-pipe/.env.local` and process environment.
- Missing placeholder values fail source execution with a clear config error.
- `agent-pipe source run <sourceId>` writes a `job_runs` row.
- Run status is stored in the local SQLite database.
- Source runs record `running`, then `succeeded` or `failed`.
- Source runs store `records_written` and `error_message` when relevant.
- Failed source runs still update their `job_runs` row to `failed`.
- Config, HTTP, parse, and database errors are captured in `job_runs.error_message`.
- Any non-2xx HTTP response fails the source run.
- Failed HTTP responses do not write records from that response.
- Paginated runs keep records written by earlier successful pages if a later page fails.
- Paginated runs with a later page failure mark the job as `failed` and store `records_written` so far.
- Phase 2 does not retry failed HTTP requests.
- Source-ingested records store the configured source ID in `records.source`.
- Source-ingested record metadata includes request details such as URL, status code, fetched timestamp, and ingestion type.
- Successful source runs print compact JSON with `sourceId`, `entity`, `recordsWritten`, and `jobRunId`.
- `agent-pipe source run <sourceId>` always prints JSON on success.
- `agent-pipe source run <sourceId>` validates only the selected source.
- Unrelated invalid or unsupported sources do not block a selected valid source run.
- Automated tests use a local HTTP server, not the live CoinGecko API.
- The final Phase 2 task performs a live CoinGecko smoke test.
- Phase 2 updates the README quickstart with `source list` and `source run`.
- `sources.yaml` is dynamic per project; each project may define different datapoints and source configurations.
- Sources are typed by `type` so future ingestion types can fit the same source interface.
- Source IDs are the keys under `sources`, such as `coingecko_coins_list`.
- Phase 2 implements only `type: api`.
- Phase 2 rejects unsupported source types such as `file`, `stream`, and `graphql` with clear errors.
- Phase 2 implements only API `GET`.
- Phase 2 implements non-paginated API sources with `pagination.type: none`.
- Phase 2 implements page-based API pagination with `pagination.type: page`.
- Page-based pagination supports `page` and `per_page` query parameters.
- Page-based pagination supports only `stopWhen: empty_page`.
- Page-based pagination supports `maxPages`.
- `maxPages` is required for every `pagination.type: page` source.
- Phase 2 implements API path params such as `/coins/{id}/history`.
- Phase 2 implements source params for static query/path values such as `id` and `date`.
- Phase 2 reads API path and query params from `sources.yaml` only.
- Phase 2 does not add CLI param overrides.
- Phase 2 supports only `payloadPath: $`.
- Any other `payloadPath` fails with a clear unsupported-config error.
- `payloadPath: $` accepts a top-level array or a top-level object.
- Arrays write one record per item; objects write one record.
- Before computing record IDs, source execution may fill missing `idFields` from static `params` and `query` values in `sources.yaml`.
- Phase 2 enforces configured rate limits during source execution.
- Rate limiting applies within one `source run` process only.
- Phase 2 does not coordinate rate limits across concurrent CLI processes.
- Rate limiting supports `minDelayMs` between requests.
- Phase 2 does not support `requestsPerMinute`.
- CoinGecko default sources use `minDelayMs: 10000`.

## Source Shape

```yaml
sources:
  coingecko_coins_list:
    entity: coins_list
    type: api
    idFields: [id]
    api:
      baseUrl: https://api.coingecko.com/api/v3
      endpoint: /coins/list
      method: GET
      query:
        include_platform: false
      payloadPath: $
      pagination:
        type: none
      rateLimit:
        minDelayMs: 10000

  coingecko_coins_markets:
    entity: coins_markets
    type: api
    idFields: [id]
    api:
      baseUrl: https://api.coingecko.com/api/v3
      endpoint: /coins/markets
      method: GET
      query:
        vs_currency: usd
        per_page: 250
      payloadPath: $
      pagination:
        type: page
        pageParam: page
        perPageParam: per_page
        startPage: 1
        maxPages: 2
        stopWhen: empty_page
      rateLimit:
        minDelayMs: 10000

  coingecko_coin_history:
    entity: coin_history
    type: api
    idFields: [id, date]
    api:
      baseUrl: https://api.coingecko.com/api/v3
      endpoint: /coins/{id}/history
      method: GET
      params:
        id: bitcoin
      query:
        date: 30-12-2025
        localization: false
      payloadPath: $
      pagination:
        type: none
      rateLimit:
        minDelayMs: 10000
```

## CLI Shape

```bash
npm run agent-pipe -- source list
npm run agent-pipe -- source list --json
npm run agent-pipe -- source run coingecko_coins_list
```

Successful output:

```json
{
  "sourceId": "coingecko_coins_list",
  "entity": "coins_list",
  "recordsWritten": 123,
  "jobRunId": "..."
}
```

## Out Of Scope

- `type: file`.
- `type: stream`.
- `type: graphql`.
- API pagination beyond `pagination.type: none` and `pagination.type: page`.
- Payload extraction beyond `payloadPath: $`.
- Scheduler loop.
- Cron support.
- Arbitrary shell job runner.
- Retried/backoff execution.
- Live network calls in routine automated tests.
