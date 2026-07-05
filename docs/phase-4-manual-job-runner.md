# Phase 4 - Manual Job Runner

## Goal

Add manual job execution before scheduler work. Phase 4 introduces configured jobs in `.agent-pipe/schedules.yaml`, `agent-pipe jobs list`, and `agent-pipe run --job <jobId>`.

Jobs run shell commands from the project root, parse clean stdout JSON, and write records through the existing generic record store.

## Decisions

- Phase 4 implements manual job execution, not scheduler behavior.
- Phase 4 does not add `agent-pipe scheduler start`.
- Phase 4 does not add cron support.
- Phase 4 does not add retries.
- Phase 4 does not add `outputFile`.
- Job command output is stdout JSON only.
- Job stdout must be valid JSON object or array of objects.
- Job commands run through the platform shell from the project root.
- Job commands load `.agent-pipe/.env.local`.
- Process environment values take precedence over `.agent-pipe/.env.local`.
- Job commands inherit the current process environment.
- Jobs are configured in `.agent-pipe/schedules.yaml`.
- Jobs are a map keyed by job ID.
- New `agent-pipe init` defaults should use `jobs: {}`.
- Existing empty `jobs: []` should be treated as no jobs for compatibility.
- Phase 4 adds `agent-pipe jobs list`.
- Phase 4 adds `agent-pipe run --job <jobId>`.
- `agent-pipe run --job <jobId>` writes a `job_runs` row for every attempted run.
- `agent-pipe run --job <jobId>` prints compact JSON on success.
- Records written by a job use `records.source = jobId`.
- Same-job locking prevents starting a job when the same `job_id` already has `status = running`.
- Same-job lock conflicts create a `skipped` run row.
- Unrelated jobs are not blocked by the same-job lock.
- Timeout is supported with optional `timeoutMs`.
- Default timeout is `60000`.
- `timeoutMs` must be a positive integer.
- Do not store full stdout or stderr in metadata.

## Job Shape

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

Rules:

- Job IDs are the keys under `jobs`.
- Each job must define `entity`.
- Each job must define `command`.
- `entity` must refer to a configured entity in `entities`.
- `timeoutMs` is optional.

## CLI Shape

```bash
npm run agent-pipe -- jobs list
npm run agent-pipe -- jobs list --json
npm run agent-pipe -- run --job collect_prices
```

Successful `run --job` output:

```json
{
  "jobId": "collect_prices",
  "entity": "coins_list",
  "recordsWritten": 2,
  "jobRunId": "..."
}
```

## Jobs List

Default output is a compact table with:

```text
JOB_ID  ENTITY  COMMAND
```

Rules:

- `jobs list --json` returns the same compact fields as JSON.
- Empty table output prints only the header row.
- Empty JSON output is `[]`.
- `jobs list` does not execute jobs.

## Run Job

`agent-pipe run --job <jobId>` executes one configured job.

Rules:

- Unknown jobs fail clearly.
- Invalid job config fails clearly.
- Missing project files or database files fail clearly.
- Unsupported SQLite schema versions fail clearly.
- Non-zero command exit fails the run.
- Timed-out commands fail the run.
- Invalid stdout JSON fails the run.
- Stdout JSON object writes one record.
- Stdout JSON array writes one record per item.
- Duplicate generated record IDs within one job output follow the existing record builder behavior.
- Missing or invalid entity `idFields` fail the run.
- Successful reruns use existing upsert behavior.

## Run History

`run --job` writes to `job_runs`.

Status behavior:

- `running` while command executes.
- `succeeded` after valid stdout JSON is written.
- `failed` for unknown or invalid config, command failure, timeout, invalid JSON, missing id fields, or database errors.
- `skipped` when the same `job_id` already has a `running` row.

`job_runs.metadata_json` includes:

- `jobId`
- `command`
- `exitCode`
- `durationMs`
- `timeoutMs`

`records.metadata_json` includes:

- `jobId`
- `command`
- `ingestionType: "job"`

On command failure, `job_runs.error_message` should include a stderr or error snippet capped at 1000 characters.

Environment precedence for child commands:

1. Current process environment.
2. `.agent-pipe/.env.local` for keys not already set in the process environment.

The implementation should parse `.agent-pipe/.env.local` using the same simple `KEY=value` behavior already used by source execution.

## Tests

Add coverage for:

- `jobs list` default table.
- `jobs list --json`.
- `run --job` successful stdout object ingestion.
- `run --job` successful stdout array ingestion.
- Idempotent rerun/upsert behavior.
- `.agent-pipe/.env.local` values available to child commands.
- Process environment precedence over `.agent-pipe/.env.local`.
- Non-zero exit creates a failed run.
- Invalid stdout JSON creates a failed run.
- Timeout creates a failed run.
- Same-job running lock creates a skipped run.
- Unknown job fails clearly.
- Unknown entity fails clearly.
- Invalid `timeoutMs` fails clearly.

Acceptance coverage should run `init`, write a small local collector script, configure a job, run it, verify records through `records list/show`, and verify run history through `runs list/show`.

Required checks:

```bash
npm test
npm run typecheck
git diff --check
```

## AgentRig Breakdown

- Task 1: Add jobs config parsing and `jobs list`.
- Task 2: Implement `run --job` success path.
- Task 3: Implement failure, timeout, env, and same-job lock behavior.
- Task 4: Add acceptance coverage and README quickstart updates.
- Task 5: Final Phase 4 verification and task cleanup.

## Out Of Scope

- `agent-pipe scheduler start`.
- Cron support.
- Interval schedules.
- Retry or backoff policy.
- `outputFile`.
- Noisy stdout parsing.
- Arg-array command execution.
- Parallel job execution policy beyond same-job locking.
- Live API smoke tests.
