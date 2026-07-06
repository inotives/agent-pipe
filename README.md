# agent-pipe

Local datastore, API ingestion, job runner, and scheduler for agent workflows inside a project repository.

`agent-pipe` stores project-local records in `.agent-pipe/data/local.sqlite`, tracks source and job runs, and exposes small CLI commands for local inspection and scheduling.

## Quickstart

```bash
npm install
npm run agent-pipe -- --help
npm test
npm run typecheck
```

Initialize a project:

```bash
npm run agent-pipe -- init
```

This creates:

```text
.agent-pipe/
  project.yaml
  schedules.yaml
  sources.yaml
  .env.local
  data/
    local.sqlite
  logs/
```

## Local Records

Write records from a JSON file:

```bash
npm run agent-pipe -- put --entity coins_list --file ./coins.json
```

Example `coins.json`:

```json
[
  { "id": "bitcoin", "symbol": "btc", "name": "Bitcoin" },
  { "id": "ethereum", "symbol": "eth", "name": "Ethereum" }
]
```

Records are upserted by configured `idFields`. `deleted_at` defaults to `null`, and non-null values represent soft-deleted records.

## Declarative API Sources

`init` creates `.agent-pipe/sources.yaml` with CoinGecko examples:

- `coingecko_coins_list`
- `coingecko_coins_markets`
- `coingecko_coin_history`

List and run sources:

```bash
npm run agent-pipe -- source list
npm run agent-pipe -- source list --json
npm run agent-pipe -- source run coingecko_coins_list
```

Implemented source support:

- `type: api`
- `method: GET`
- `payloadPath: $`
- `pagination.type: none`
- `pagination.type: page`
- path/query params from YAML
- `${NAME}` placeholders from `.agent-pipe/.env.local` and process env
- `rateLimit.minDelayMs`

Unsupported source types such as `file`, `stream`, and `graphql` fail clearly for now.

## Visibility

Inspect stored records:

```bash
npm run agent-pipe -- records list
npm run agent-pipe -- records list --entity coins_list
npm run agent-pipe -- records list --source coingecko_coins_list
npm run agent-pipe -- records list --limit 20
npm run agent-pipe -- records list --include-deleted
npm run agent-pipe -- records list --json
npm run agent-pipe -- records show 'agent-pipe:coins_list:["bitcoin"]'
```

Inspect source and job run history:

```bash
npm run agent-pipe -- runs list
npm run agent-pipe -- runs list --status failed
npm run agent-pipe -- runs list --job-id coingecko_coins_list
npm run agent-pipe -- runs list --limit 20
npm run agent-pipe -- runs list --json
npm run agent-pipe -- runs show '<run-id>'
```

## Manual Jobs

Jobs live in `.agent-pipe/schedules.yaml`:

```yaml
entities:
  coins_list:
    idFields:
      - id

jobs:
  collect_prices:
    entity: coins_list
    command: npm run collect:prices
    timeoutMs: 60000
```

List and run jobs:

```bash
npm run agent-pipe -- jobs list
npm run agent-pipe -- jobs list --json
npm run agent-pipe -- run --job collect_prices
```

Job commands run from the project root, load `.agent-pipe/.env.local`, must print a JSON object or array to stdout, and write records through the same local store. Same-job running conflicts create a skipped run row.

## Scheduler

Scheduled jobs use `schedule.type: cron`; manual jobs use `schedule.type: manual` or no schedule.

```yaml
jobs:
  collect_prices:
    entity: coins_list
    command: npm run collect:prices
    timeoutMs: 60000
    schedule:
      type: cron
      expression: "5 0 * * *"

  refresh_reference_data:
    entity: coins_list
    command: npm run refresh:reference
    schedule:
      type: manual
```

Run the scheduler:

```bash
npm run agent-pipe -- scheduler start --once
npm run agent-pipe -- scheduler start
npm run agent-pipe -- scheduler start --poll-interval-ms 60000
```

Scheduler output is newline-delimited JSON events. It does not catch up missed runs and does not retry failed jobs.

Clear stale running rows for one job:

```bash
npm run agent-pipe -- runs clear-running --job-id collect_prices
```

## Phase 6 Planned Multi-DB Workflow

Phase 6 will add multiple SQLite database support. Planned flow:

```bash
# Add another database in .agent-pipe/project.yaml.
npm run agent-pipe -- db status
npm run agent-pipe -- db init
npm run agent-pipe -- db status
```

`agent-pipe init` is for creating the project scaffold. After a project already exists, add SQLite databases by editing `.agent-pipe/project.yaml`, then run `db init` to prepare all configured database files. Runtime commands may also prepare a selected missing database on first use.
