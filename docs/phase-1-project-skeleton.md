# Phase 1 - Project Skeleton

## Goal

Create the smallest working Agent Pipe CLI that can initialize local project storage and ingest deterministic records into SQLite.

## Scope

- TypeScript CLI runnable through `npm run agent-pipe -- ...`.
- Minimum runtime is Node.js 22 LTS.
- TypeScript output/module style uses ESM.
- `package.json` includes a `bin` entry for the future installed `agent-pipe` command.
- CLI command parsing uses `commander`.
- Config and input validation uses `zod`.
- SQLite uses `better-sqlite3`.
- SQLite bootstrap enables WAL mode.
- SQLite bootstrap creates `schema_migrations` with version `1`.
- Existing databases with an unsupported schema version fail clearly; migrations are not implemented in Phase 1.
- Tests use Vitest.
- Phase 1 does not require coverage thresholds.
- Phase 1 does not include linting.
- Phase 1 does not include formatting tooling.
- Phase 1 does not include CI config.
- TypeScript is checked with `tsc --noEmit` via `npm run typecheck`.
- Acceptance tests call the CLI through child processes; small helper tests may import pure functions directly.
- README includes a short Phase 1 quickstart.
- README includes a tiny two-record `coins.json` example.
- Tests create fixture files in temporary directories; no committed fixture files are required.
- Commit `package-lock.json` for reproducible npm installs.
- Generated `.agent-pipe/` project data is gitignored.
- `agent-pipe init` creates `.agent-pipe/project.yaml`, `.agent-pipe/schedules.yaml`, `.agent-pipe/data/local.sqlite`, and `.agent-pipe/logs/`.
- `agent-pipe init` defaults `projectId` from the current folder name and supports `--project-id` override.
- `projectId` must match `^[a-z0-9_-]+$`.
- Default `projectId` lowercases the folder name and normalizes common separators to hyphens before validation.
- `projectName` defaults to a humanized version of `projectId`.
- `agent-pipe init` supports `--project-name` override.
- Successful `init` prints compact JSON to stdout.
- `init` success output uses project-relative paths.
- CLI errors print human-readable text to stderr and exit non-zero.
- `init` leaves existing config files untouched while still creating missing directories and bootstrapping SQLite.
- `init` fails by default if a parent directory already contains `.agent-pipe/`; nested projects are out of scope.
- Commands find the project root by walking upward from the current working directory to the nearest `.agent-pipe/`.
- Default `schedules.yaml` defines `coins_list` with `idFields: [id]` and `jobs: []`.
- This Phase 1 entity config is temporary; Phase 2 HTTP sources will move source-owned `idFields` into `.agent-pipe/sources.yaml`.
- Phase 1 does not create `.agent-pipe/sources.yaml`.
- Entity names must match `^[a-z0-9_-]+$`.
- SQLite bootstrap creates `records`, `job_runs`, and `schema_migrations`.
- `put` does not write `job_runs`; that starts with managed job/source execution.
- `agent-pipe put --entity <entity> --file <json>` reads entity config from `.agent-pipe/schedules.yaml`.
- `put` requires `init` to have been run first; it does not auto-create `.agent-pipe/`.
- `put --file` requires a file path; stdin via `--file -` is out of scope.
- Relative `put --file` paths resolve from the current working directory.
- `put --file` accepts either a JSON array or one JSON object.
- `captured_at` defaults to ingestion time.
- Timestamps use ISO 8601 UTC strings.
- `deleted_at` defaults to null; a non-null value means the record is soft-deleted.
- Upserts preserve `created_at`, update `updated_at`, and set `deleted_at` back to null.
- Record identity uses `<projectId>:<entity>:<localId>`.
- `localId` is the JSON-encoded tuple of configured `idFields` values.
- `localId` preserves native JSON value types before `JSON.stringify`.
- Phase 1 `idFields` refer to top-level payload fields only.
- `idFields` values must be scalar JSON values: string, number, or boolean.
- `put` uses upsert semantics so reruns are idempotent.
- `put` prints compact JSON to stdout, such as `{"projectId":"agent-pipe-demo","entity":"coins_list","recordsWritten":12}`.
- `put` success output does not include the database path.
- `put` success output does not include `recordsFailed`; failures exit non-zero and write nothing.
- `recordsWritten` counts accepted input records, including idempotent upserts.
- Missing `idFields` fail with a clear error.
- `idFields` reject only null, missing, and empty-string values; `0` and `false` are valid.
- Unknown entities fail clearly and list configured entities.
- Phase 1 validates only configured `idFields`; the full payload is stored as-is.
- `payload_json` and `metadata_json` are stored as compact JSON.
- Payload JSON preserves parsed input key order; keys are not sorted.
- `put` is all-or-nothing: validate all records first, then write in one transaction.
- Phase 1 uses SQLite transactions only; no explicit app-level write lock.
- Duplicate record IDs inside one input file are allowed; the last item wins.
- `source` is set to `file` for Phase 1 `put` records.
- `metadata_json` stores minimal file-ingestion metadata, including `inputFile`.
- Default tests cover the acceptance path.

## Out Of Scope

- `agent-pipe run --job`.
- `agent-pipe records list`.
- Delete/restore commands.
- Declarative HTTP source runner.
- HTTP pagination, rate limiting, retries, and API key handling.
- Scheduler loop.
- Cron parsing.
- Market Pipe sync.
- Dashboard or server process.
- NDJSON input.
- Stdin input for `put`.
- Linting setup.
- Formatting tooling.
- CI config.

## Acceptance Checks

- `npm test`
- `npm run typecheck`
- `npm run agent-pipe -- init`
- `npm run agent-pipe -- put --entity coins_list --file <fixture>`
- Re-running the same `put` does not duplicate records.

## Next Phase Candidate

Implement declarative HTTP source ingestion with `.agent-pipe/sources.yaml`, where users add source specs and Agent Pipe owns fetching, pagination, rate limiting, payload extraction, `idFields`, and record writes. The first source should be CoinGecko `coins_list`. `schedules.yaml` should then describe timing, not source identity.
