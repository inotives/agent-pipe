# Phase 3 - Local Visibility CLI

## Goal

Add CLI visibility over the local SQLite datastore so users can inspect what `put` and `source run` already wrote before adding job runner or scheduler behavior.

## Decisions

- Phase 3 implements local datastore visibility, not scheduler behavior.
- Phase 3 does not add `agent-pipe run --job`.
- Phase 3 does not add new ingestion source types.
- Phase 3 adds `agent-pipe records list`.
- Phase 3 adds `agent-pipe records show <id>`.
- Phase 3 adds `agent-pipe runs list`.
- Phase 3 adds `agent-pipe runs show <id>`.
- The command group is `runs`, not `jobs`, because Phase 3 exposes existing `job_runs` history before user-defined jobs exist.
- List commands print compact tables by default.
- List commands support `--json` for automation.
- Detail commands print pretty JSON only.
- Detail commands parse `payload_json` and `metadata_json` into JSON values when possible.
- `records show` looks up records by full stored `records.id`.
- `runs show` looks up runs by full stored `job_runs.id`.
- Unknown record or run IDs fail clearly.
- Missing project files or database files fail clearly.
- Unsupported SQLite schema versions fail clearly.
- Invalid `--limit` values fail clearly.
- Empty list results are not errors.
- Phase 3 is read-only except for test fixture setup.

## CLI Shape

```bash
npm run agent-pipe -- records list
npm run agent-pipe -- records list --entity coins_list
npm run agent-pipe -- records list --source coingecko_coins_list
npm run agent-pipe -- records list --limit 20
npm run agent-pipe -- records list --include-deleted
npm run agent-pipe -- records list --json
npm run agent-pipe -- records show '<record-id>'

npm run agent-pipe -- runs list
npm run agent-pipe -- runs list --status failed
npm run agent-pipe -- runs list --job-id coingecko_coins_list
npm run agent-pipe -- runs list --limit 20
npm run agent-pipe -- runs list --json
npm run agent-pipe -- runs show '<run-id>'
```

## Records List

Default output is a compact table with:

```text
ID  ENTITY  SOURCE  UPDATED_AT
```

Rules:

- Default ordering is `updated_at desc`.
- Default limit is `20`.
- `--limit <n>` overrides the limit.
- `--entity <entity>` filters by `records.entity`.
- `--source <source>` filters by `records.source`.
- Records where `deleted_at is not null` are hidden by default.
- `--include-deleted` includes soft-deleted records.
- `--json` returns the same fields as the compact table as JSON.
- Empty table output prints only the header row.
- Empty JSON output is `[]`.
- `--limit` must be a positive integer.

## Records Show

`records show <id>` outputs one record as pretty JSON.

Output includes all record fields:

- `id`
- `project_id`
- `entity`
- `local_id`
- `source`
- `captured_at`
- `payload`
- `metadata`
- `created_at`
- `updated_at`
- `deleted_at`

`payload` comes from parsed `payload_json`. `metadata` comes from parsed `metadata_json` or `null`.

`records show <id>` may return a soft-deleted record when the exact ID is requested.

## Runs List

Default output is a compact table with:

```text
ID  JOB_ID  ENTITY  STATUS  RECORDS_WRITTEN  STARTED_AT  FINISHED_AT
```

Rules:

- Default ordering is `started_at desc`.
- Default limit is `20`.
- `--limit <n>` overrides the limit.
- `--status <status>` filters by `job_runs.status`.
- `--job-id <jobId>` filters by `job_runs.job_id`.
- `--json` returns the same fields as the compact table as JSON.
- Empty table output prints only the header row.
- Empty JSON output is `[]`.
- `--limit` must be a positive integer.
- `--status` is an exact string match against stored status.

## Runs Show

`runs show <id>` outputs one run as pretty JSON.

Output includes all run fields:

- `id`
- `job_id`
- `entity`
- `status`
- `started_at`
- `finished_at`
- `records_written`
- `error_message`
- `metadata`

`metadata` comes from parsed `metadata_json` or `null`.

## Implementation Notes

- Reuse the existing project-root lookup.
- Reuse the existing SQLite database path convention.
- Reuse the existing schema-version check.
- Keep query modules read-only.
- Do not expand ingestion modules to own read/query behavior.
- Follow the existing CLI error style: clear stderr message and non-zero exit.

## Tests

Add coverage for:

- `records list` default table.
- `records list --entity`.
- `records list --source`.
- `records list --limit`.
- `records list --include-deleted`.
- `records list --json`.
- `records show <id>` success.
- `records show <id>` unknown ID failure.
- `runs list` default table.
- `runs list --status`.
- `runs list --job-id`.
- `runs list --limit`.
- `runs list --json`.
- `runs show <id>` success with full error and metadata.
- `runs show <id>` unknown ID failure.

Acceptance coverage should run `init`, ingest local records with `put` or `source run`, then verify the records and runs visibility commands.

Required checks:

```bash
npm test
npm run typecheck
git diff --check
```

## AgentRig Breakdown

- Task 1: Add Phase 3 docs and CLI contract.
- Task 2: Implement `records list` and `records show`.
- Task 3: Implement `runs list` and `runs show`.
- Task 4: Add acceptance coverage and README quickstart updates.

## Out Of Scope

- `agent-pipe run --job`.
- `agent-pipe scheduler start`.
- New ingestion types.
- Date range filters.
- Payload text search.
- Sorting options beyond the default newest-first order.
- `deleted-only` filtering.
- Live API smoke tests.
