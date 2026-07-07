# Phase 6 - Runtime Hardening And Multi-DB SQLite

## Goal

Harden the local runtime before adding more ingestion types. Phase 6 adds project-level database configuration, supports multiple SQLite files under `.agent-pipe/data/`, centralizes database resolution, adds built-in indexes for current query paths, and keeps scheduler execution safe when multiple databases are configured.

Phase 6 stays inside `agent-pipe`. It does not add `market-pipe` sync or warehouse behavior.

## Decisions

- Database definitions live in `.agent-pipe/project.yaml`.
- `local` remains the default database.
- Each configured database is a SQLite file under `.agent-pipe/data/`.
- Sources and jobs may opt into a database by name.
- `put` may opt into a database with `--database`.
- Records and runs visibility default to the default database.
- Records and runs visibility may read another configured database with `--database`.
- Run history is stored in the same database that the source or job writes to.
- Pre-release incompatible SQLite files may be replaced directly.
- No legacy backup or migration path is required in this phase.
- Add built-in indexes to every managed database.
- Do not add user-defined YAML index definitions yet.
- Scheduler locking is per database, not global.
- Scheduler jobs targeting different databases may run concurrently.
- Scheduler jobs targeting the same database run sequentially in the same tick.
- Do not add a durable queue, retry policy, or missed-run catch-up.
- `agent-pipe init` remains the project scaffold command.
- Adding a later database to `project.yaml` does not require rerunning `agent-pipe init`.
- Add `agent-pipe db init` as the explicit operator command for preparing configured databases.
- Runtime commands may bootstrap a selected configured database on first use.

## Project Config Shape

`agent-pipe init` remains the project scaffold command. It should create this shape in `.agent-pipe/project.yaml` for new projects:

```yaml
projectId: agent-pipe
projectName: "Agent Pipe"
defaultDatabase: local
databases:
  local:
    type: sqlite
    path: data/local.sqlite
```

Projects may add more databases:

```yaml
projectId: agent-pipe
projectName: "Agent Pipe"
defaultDatabase: local
databases:
  local:
    type: sqlite
    path: data/local.sqlite
  research:
    type: sqlite
    path: data/research.sqlite
```

Rules:

- `defaultDatabase` is required after Phase 6 init writes the new shape.
- `databases` is a map keyed by database name.
- Database names must be non-empty strings suitable for CLI use.
- Only `type: sqlite` is supported.
- `path` is relative to `.agent-pipe/`.
- Supported paths must stay under `.agent-pipe/data/`.
- Unknown database references fail clearly.
- Adding a new database to this file should not require rerunning project init.

## Source And Job Routing

Sources may target a database:

```yaml
sources:
  coingecko_coins_list:
    database: research
    entity: coins_list
    type: api
    idFields:
      - id
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
```

Jobs may target a database:

```yaml
jobs:
  collect_ohlcv:
    database: local
    entity: daily_ohlcv
    command: npm run collect:ohlcv
    schedule:
      type: cron
      expression: "0 * * * *"

  collect_research:
    database: research
    entity: research_notes
    command: npm run collect:research
    schedule:
      type: cron
      expression: "0 0 * * *"
```

Rules:

- Missing `database` means `defaultDatabase`.
- Source records and source run history are written to the selected database.
- Job records and job run history are written to the selected database.
- The same record schema and job run schema are used in every managed database.

## CLI Shape

```bash
npm run agent-pipe -- db status
npm run agent-pipe -- db init
npm run agent-pipe -- put --entity coins_list --file ./coins.json --database research
npm run agent-pipe -- source run coingecko_coins_list
npm run agent-pipe -- run --job collect_research
npm run agent-pipe -- records list --database research
npm run agent-pipe -- records show <record-id> --database research
npm run agent-pipe -- runs list --database research
npm run agent-pipe -- runs show <job-run-id> --database research
npm run agent-pipe -- runs clear-running --job-id collect_research --database research
```

Rules:

- `db status` reports all configured databases.
- `db init` creates or prepares all configured databases.
- `put --database` is optional and defaults to `defaultDatabase`.
- `records` and `runs` commands default to `defaultDatabase`.
- `--database <name>` must reference a configured database.

## Database Init And Status

`agent-pipe db init` is the explicit operator command for preparing configured SQLite databases after `project.yaml` changes.

Rules:

- It creates missing configured SQLite database files.
- It creates the standard tables and built-in indexes.
- It is safe to rerun.
- It does not overwrite YAML config.
- It may replace incompatible pre-release SQLite files directly.
- Runtime commands that open a configured database may also bootstrap that database on first use, so agent workflows do not fail only because a configured empty database file is missing.

`agent-pipe db status` should output JSON for automation.

Required fields per database:

- database name
- configured path
- absolute path
- whether the file exists
- schema status
- schema version when readable
- table health for `records`, `job_runs`, and `schema_migrations`
- built-in index status

The command should fail clearly when `.agent-pipe/project.yaml` is missing or invalid.

## Schema And Indexes

Each managed SQLite database uses the existing Phase 5 schema:

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

create table if not exists schema_migrations (
  version integer primary key
);
```

Add built-in indexes for current query paths:

- records by `entity`
- records by `source`
- records by `updated_at`
- records by `deleted_at`
- job runs by `job_id`
- job runs by `status`
- job runs by `started_at`

Rules:

- Indexes are created for every configured database.
- Index creation must be idempotent.
- User-defined index YAML is out of scope.
- Existing pre-release incompatible database files may be replaced directly during init/runtime bootstrap.

## Scheduler Behavior

The scheduler resolves each due job to its target database.

Rules:

- Jobs targeting different databases may run concurrently.
- Jobs targeting the same database run sequentially in the same scheduler tick.
- A running job in one database does not block a due job in another database.
- A running job in a database blocks or delays only other jobs targeting that same database.
- Scheduler JSON-line events include the database name for job-level events.
- No missed-run catch-up is added.
- No durable queue is added.

Example:

- `collect_research` targets `research` and runs daily at `00:00`.
- `collect_ohlcv` targets `local` and runs hourly at minute `0`.
- At `00:00`, both jobs are due and may run concurrently because they target different databases.

## Tests

Add coverage for:

- `init` writes the new `project.yaml` database shape.
- `db init` bootstraps all configured SQLite databases.
- `db init` is safe to rerun after adding a second database to `project.yaml`.
- Invalid database config fails clearly.
- Unknown database references in sources and jobs fail clearly.
- `put --database` writes records to the selected database.
- `source run` writes records and run history to the source database.
- `run --job` writes records and run history to the job database.
- `records list/show --database` reads from the selected database.
- `runs list/show/clear-running --database` reads or updates the selected database.
- `db status` reports schema and index health for all configured databases.
- Built-in indexes are created idempotently.
- Incompatible pre-release SQLite files are replaced during bootstrap.
- First use of a configured missing database bootstraps that database.
- Scheduler runs due jobs targeting different databases concurrently.
- Scheduler runs due jobs targeting the same database sequentially in one tick.

Final live validation should run CoinGecko smoke ingestion into the default database and a second configured database, then verify:

- records were written to the expected database files,
- run history exists beside the written records,
- `db status` reports healthy schema and indexes.

Required checks:

```bash
npm test
npm run typecheck
git diff --check
```

## AgentRig Breakdown

- Task 1: Add project database config parsing and default init shape.
- Task 2: Centralize SQLite bootstrap, schema validation, incompatible pre-release replacement, and built-in indexes.
- Task 3: Add `db init` and `db status`.
- Task 4: Route `put`, `source run`, and `run --job` through configured databases.
- Task 5: Add `--database` support for records and runs commands.
- Task 6: Update scheduler to use per-database locking and same-tick sequencing.
- Task 7: Add Phase 6 acceptance tests, CoinGecko live smoke notes, and README updates.
- Task 8: Final Phase 6 verification and task cleanup.

## Out Of Scope

- `market-pipe` sync.
- Postgres or warehouse schema work.
- User-defined index YAML.
- Non-SQLite database types.
- SQLite files outside `.agent-pipe/data/`.
- Legacy production-safe migration and backup workflow.
- Durable scheduler queue.
- Retry or backoff policy.
- Missed-run catch-up.
