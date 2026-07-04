# Agent Pipe Project Specs

## Goal

Build `agent-pipe` as a small local datastore and scheduler for agents working inside project repositories.

The primary objective is to let agents collect useful project-local data from public APIs, generated research, local files, scripts, and lightweight jobs, then store that data in a predictable SQLite database under the project folder. A later `market-pipe` phase can sync this local store into the warehouse.

## Product Boundary

`agent-pipe` owns the local project runtime:

- `.agent-pipe/` folder layout.
- Project identity.
- Local SQLite datastore.
- Entity definitions.
- YAML schedules.
- Manual job execution.
- Scheduler loop for local jobs.
- Job run history and error capture.

`market-pipe` owns warehouse ingestion:

- Postgres raw schemas.
- Source-owned warehouse tables.
- dbt transforms.
- Sync from an `agent-pipe` SQLite datastore into warehouse raw records.

The first `agent-pipe` prototype should not depend on `market-pipe`.

## Non-Goals

- No Postgres dependency in the prototype.
- No cloud sync adapters in the prototype.
- No distributed workers.
- No long-running web server.
- No dashboard.
- No generalized plugin marketplace.
- No bidirectional sync.
- No dbt.
- No natural-table schema generator for every entity type.

## Recommended Stack

- Runtime: Node.js 22 LTS.
- Language: TypeScript.
- Package manager: npm.
- CLI: small command parser such as `commander`.
- Local execution: `tsx`.
- SQLite client: `better-sqlite3` unless the target Node version has a stable built-in SQLite API.
- Validation: `zod`.
- Config format: YAML.
- Testing: Node's built-in test runner or Vitest. Pick one.

## Local Folder Shape

Each project that uses `agent-pipe` should have:

```text
.agent-pipe/
  project.yaml
  schedules.yaml
  data/
    local.sqlite
  logs/
```

`project.yaml` defines identity:

```yaml
projectId: crypto-trading
projectName: Crypto Trading
```

`schedules.yaml` defines entities and jobs:

```yaml
entities:
  - entity: executed_trades
    idFields: [broker, trade_id]

  - entity: daily_ohlcv
    idFields: [exchange, symbol, date]

jobs:
  - jobId: collect_daily_ohlcv
    entity: daily_ohlcv
    command: npm run collect:ohlcv
    schedule:
      type: cron
      expression: "5 0 * * *"

  - jobId: collect_executed_trades
    entity: executed_trades
    command: npm run collect:trades
    schedule:
      type: manual
```

## Datastore Model

Use one generic local table for records. Do not create one SQLite table per entity in the first prototype.

```sql
create table if not exists records (
  id text primary key,
  project_id text not null,
  entity text not null,
  local_id text not null,
  source text,
  captured_at text,
  payload_json text not null,
  metadata_json text,
  created_at text not null,
  updated_at text not null,
  deleted_at text,
  unique (project_id, entity, local_id)
);
```

The full row data lives in `payload_json`.

Examples:

- `crypto-trading.executed_trades` stores each trade execution as one record.
- `stock-trading.daily_ohlcv` stores each symbol/date candle as one record.
- `market-research.daily_news` stores each captured news item as one record.

`id` format:

```text
<project_id>:<entity>:<local_id>
```

`local_id` is built from configured `idFields`.

Use upsert semantics so reruns are idempotent.

## Job Run Model

Track local execution separately from data records:

```sql
create table if not exists job_runs (
  id text primary key,
  job_id text not null,
  entity text,
  status text not null,
  started_at text not null,
  finished_at text,
  records_written integer not null default 0,
  error_message text,
  metadata_json text
);
```

Allowed statuses:

```text
running
succeeded
failed
skipped
```

## CLI Shape

Installed form:

```bash
agent-pipe init
agent-pipe put --entity executed_trades --file ./trades.json
agent-pipe run --job collect_daily_ohlcv
agent-pipe scheduler start
agent-pipe records list --entity daily_ohlcv
agent-pipe jobs list
```

Local development form:

```bash
npm run agent-pipe -- init
npm run agent-pipe -- put --entity executed_trades --file ./trades.json
npm run agent-pipe -- scheduler start
```

## Command Behavior

### `agent-pipe init`

Creates `.agent-pipe/`, `project.yaml`, `schedules.yaml`, and `data/local.sqlite` if missing.

It should not overwrite existing files unless `--force` is passed.

### `agent-pipe put`

Writes records into local SQLite.

Input can start simple:

```bash
agent-pipe put --entity executed_trades --file ./trades.json
```

Accepted JSON shape:

```json
[
  {
    "broker": "example",
    "trade_id": "t-001",
    "symbol": "MSFT",
    "qty": 10,
    "price": 420.5
  }
]
```

The command reads `idFields` from `schedules.yaml`, builds `local_id`, builds `id`, and upserts records.

### `agent-pipe run`

Runs one configured job command.

The job command is responsible for producing data. The first prototype can support one of these simple contracts:

```bash
# command writes JSON to stdout
agent-pipe run --job collect_daily_ohlcv
```

or:

```yaml
jobs:
  - jobId: collect_daily_ohlcv
    entity: daily_ohlcv
    command: npm run collect:ohlcv
    outputFile: .agent-pipe/tmp/daily_ohlcv.json
```

Prefer stdout first. Add `outputFile` only if stdout is awkward for real jobs.

### `agent-pipe scheduler start`

Starts a simple local loop that checks schedules and runs due jobs.

For the prototype:

- one process
- one job at a time
- SQLite-backed job lock
- no parallel execution
- no daemon manager

This avoids SQLite write-lock problems and keeps behavior predictable.

## Scheduler Rules

- Manual jobs never run automatically.
- Cron jobs run when due.
- If the scheduler was stopped during a due time, the first prototype may skip missed runs.
- A job must not start if the same job is already running.
- Failed jobs should be recorded, not retried automatically in the first prototype.
- Retry policy can be added later when real jobs need it.

## Market Pipe Sync Contract

`market-pipe` should later read from `.agent-pipe/data/local.sqlite`.

The sync-facing contract is:

- `records.id`
- `records.project_id`
- `records.entity`
- `records.local_id`
- `records.source`
- `records.captured_at`
- `records.payload_json`
- `records.metadata_json`
- `records.created_at`
- `records.updated_at`
- `records.deleted_at`

`market-pipe` should treat `payload_json` as raw payload and unpack it later in dbt.

## Validation Behavior

- Missing `.agent-pipe/project.yaml` fails clearly.
- Missing `.agent-pipe/schedules.yaml` fails clearly.
- Unknown entity fails before writing.
- Missing configured `idFields` values fail before writing.
- Duplicate generated IDs in one input file fail before writing.
- Invalid JSON input fails before writing.
- Rerunning the same record updates `updated_at` and replaces `payload_json`.

## Acceptance Signals

- `agent-pipe init` creates the expected folder and SQLite database.
- `agent-pipe put --entity executed_trades --file trades.json` writes deterministic records.
- Re-running `agent-pipe put` is idempotent.
- Missing `idFields` values fail clearly.
- Overlapping entity names across different projects produce different IDs because `project_id` is part of identity.
- `agent-pipe run --job <jobId>` records job run status.
- `agent-pipe scheduler start` can run one due job in a local smoke test.
- Default tests pass.

## Prototype Phases

### Phase 1 - Project Skeleton

- TypeScript CLI.
- npm scripts.
- `.agent-pipe/` init command.
- SQLite bootstrap.
- Basic tests.

### Phase 2 - Local Record Store

- `project.yaml`.
- `schedules.yaml` entity config.
- `agent-pipe put`.
- ID generation.
- Idempotent upsert.
- Validation tests.

### Phase 3 - Job Runner

- `jobs` config.
- `agent-pipe run --job`.
- stdout JSON ingestion.
- `job_runs` table.
- Failure capture.

### Phase 4 - Local Scheduler

- Simple scheduler loop.
- Cron support.
- One job at a time.
- Job lock.
- Smoke tests.

### Phase 5 - Market Pipe Sync

- Implement in `market-pipe`, not `agent-pipe`.
- Read `.agent-pipe/data/local.sqlite`.
- Sync `records` into `market-pipe` Postgres raw table.
- Preserve `payload_json`.
- Prove idempotent warehouse reruns.

## Open Decisions

- Should job commands output JSON to stdout only, or should `outputFile` be supported from the start?
- Should `captured_at` default to ingestion time or require a configured source field per entity?
- Should schedules use cron expressions only, or also support interval syntax such as `every: 10m`?
