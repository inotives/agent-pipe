# agent-pipe

Local datastore, API ingestion, job runner, and scheduler for agent workflows inside a project repository.

`agent-pipe` stores project-local records in SQLite files under `.agent-pipe/data/`, tracks source and job runs beside the records they write, and exposes small CLI commands for local inspection and scheduling.

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
npm run agent-pipe -- put --entity coins_list --file ./coins.json --database research
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

## File Sources

`source run` also supports local file ingestion with `type: file`. `file.path` resolves relative to the project root; absolute paths and paths escaping the project root are rejected.

Example `.agent-pipe/sources.yaml`:

```yaml
sources:
  tracked_tickers:
    entity: tickers
    type: file
    idFields:
      - symbol
    file:
      path: data/json/tracked-tickers.json
      format: json

  fed_funds:
    entity: rates
    type: file
    idFields:
      - observation_date
    file:
      path: data/csv/DFF.csv
      format: csv

  research_note:
    entity: notes
    type: file
    idFields:
      - path
    file:
      path: data/markdown/2026-07-06__agent-memory-tools-context-mode-codegraph.md
      format: markdown
```

Run them with:

```bash
npm run agent-pipe -- source run tracked_tickers
npm run agent-pipe -- source run fed_funds
npm run agent-pipe -- source run research_note
```

Implemented file-source support:

- `file.format: json`
- `file.format: csv`
- `file.format: markdown`
- project-root-relative `file.path`
- JSON top-level object or array of objects
- CSV header row parsing with `csv-parse`
- Markdown payload `{ path, title, content }`

## Visibility

Inspect stored records:

```bash
npm run agent-pipe -- records list
npm run agent-pipe -- records list --entity coins_list
npm run agent-pipe -- records list --source coingecko_coins_list
npm run agent-pipe -- records list --limit 20
npm run agent-pipe -- records list --include-deleted
npm run agent-pipe -- records list --json
npm run agent-pipe -- records show 'my-project:coins_list:["bitcoin"]'
```

Inspect source and job run history:

```bash
npm run agent-pipe -- runs list
npm run agent-pipe -- runs list --status failed
npm run agent-pipe -- runs list --job-id coingecko_coins_list
npm run agent-pipe -- runs list --limit 20
npm run agent-pipe -- runs list --json
npm run agent-pipe -- runs show '<job-run-id>'
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

Job commands run from the project root, load `.agent-pipe/.env.local`, must print a JSON object or array to stdout, and write records plus run history into the selected configured database. Same-job running conflicts create a skipped run row.

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
Job-level scheduler events include the database name, and jobs in different databases may run in the same tick while same-database jobs stay sequential.

Clear stale running rows for one job:

```bash
npm run agent-pipe -- runs clear-running --job-id collect_prices
```

## Multi-DB Workflow

`agent-pipe` now supports multiple configured SQLite databases under `.agent-pipe/data/`.
Configure them in `.agent-pipe/project.yaml`:

```yaml
projectId: my-project
projectName: "My Project"
defaultDatabase: local
databases:
  local:
    type: sqlite
    path: data/local.sqlite
  research:
    type: sqlite
    path: data/research.sqlite
```

Inspect and prepare them with:

```bash
npm run agent-pipe -- db status
npm run agent-pipe -- db init
npm run agent-pipe -- db status
```

`agent-pipe init` is for creating the project scaffold. After a project already exists, add SQLite databases by editing `.agent-pipe/project.yaml`, then run `db init` to prepare all configured database files. `db status` reports configured path, absolute path, existence, schema health, table health, and built-in index health for every configured database. Runtime commands may also prepare a selected missing database on first use.

Route writes and visibility to a selected database:

```yaml
jobs:
  collect_research:
    database: research
    entity: coins_list
    command: npm run collect:research
```

```bash
npm run agent-pipe -- put --entity coins_list --file ./coins.json --database research
npm run agent-pipe -- records list --database research
npm run agent-pipe -- records show 'my-project:coins_list:["bitcoin"]' --database research
npm run agent-pipe -- runs list --database research
npm run agent-pipe -- runs show '<job-run-id>' --database research
npm run agent-pipe -- runs clear-running --job-id collect_research --database research
```

Sources and jobs default to `defaultDatabase` when `database` is omitted.
