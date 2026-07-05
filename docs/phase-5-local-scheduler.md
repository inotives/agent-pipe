# Phase 5 - Local Scheduler

## Goal

Add the first local scheduler on top of Phase 4 manual jobs. Phase 5 introduces `agent-pipe scheduler start`, cron/manual schedule config, deterministic one-shot scheduler execution for tests, JSON-line scheduler events, and a targeted stale-running recovery command.

## Decisions

- Phase 5 implements local scheduler behavior, not warehouse sync.
- Phase 5 adds `agent-pipe scheduler start`.
- Phase 5 adds `agent-pipe scheduler start --once`.
- Phase 5 adds `agent-pipe scheduler start --poll-interval-ms <ms>`.
- Phase 5 adds `agent-pipe runs clear-running --job-id <jobId>`.
- Scheduled jobs use `schedule.type: cron`.
- Manual jobs use `schedule.type: manual`.
- Jobs with no `schedule` are treated as manual for backward compatibility.
- Manual jobs never run automatically.
- Cron jobs run only when the cron expression matches the current minute.
- Missed runs are not caught up after downtime.
- Use `cron-parser` for cron expression evaluation.
- Support normal 5-field cron expressions.
- Scheduler output is newline-delimited JSON events.
- Scheduler runs at most one job at a time.
- Scheduler skips dispatch when any `job_runs` row has `status = running`.
- Manual `agent-pipe run --job <jobId>` behavior remains unchanged.
- Stale `running` rows are not cleaned automatically.
- Operators can clear stale rows for one job with `runs clear-running --job-id`.
- No retries or backoff in this phase.
- No persisted `next_run_at` state in this phase.

## Schedule Shape

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
    schedule:
      type: cron
      expression: "5 0 * * *"

  refresh_reference_data:
    entity: coins_list
    command: npm run refresh:reference
    schedule:
      type: manual
```

Rules:

- `schedule` is optional.
- Missing `schedule` means `manual`.
- `schedule.type: manual` accepts no automatic run expression.
- `schedule.type: cron` requires `expression`.
- Invalid cron expressions fail clearly when schedules are loaded.

## CLI Shape

```bash
npm run agent-pipe -- scheduler start
npm run agent-pipe -- scheduler start --once
npm run agent-pipe -- scheduler start --poll-interval-ms 1000
npm run agent-pipe -- runs clear-running --job-id collect_prices
```

## Scheduler Start

`agent-pipe scheduler start` starts a local loop that checks configured cron jobs and runs due jobs.

Rules:

- Default poll interval is `60000` milliseconds.
- `--poll-interval-ms <ms>` overrides the loop interval.
- `--poll-interval-ms` must be a positive integer.
- `--once` performs one scheduler tick and exits.
- The scheduler checks all configured jobs on each tick.
- Jobs are considered due only for the current minute.
- Jobs with missing schedule or `schedule.type: manual` are ignored by the scheduler.
- If any job is already `running`, the scheduler does not start another job in that tick.
- Due jobs are dispatched through the existing `run --job` implementation path.
- Existing Phase 4 run history behavior remains the source of truth for job success and failure.

## Scheduler Output

Scheduler output is newline-delimited JSON. Each line is one compact event object.

Events:

- `scheduler_started`
- `tick_started`
- `job_due`
- `job_succeeded`
- `job_failed`
- `job_skipped`
- `tick_finished`

Each event includes:

- `event`
- `timestamp`

Relevant events also include:

- `jobId`
- `jobRunId`
- `recordsWritten`
- `errorMessage`

## Clear Running

`agent-pipe runs clear-running --job-id <jobId>` marks currently running rows for that job as failed.

Rules:

- Only rows with the matching `job_id` and `status = running` are updated.
- Updated rows get `status = failed`.
- Updated rows get `finished_at` set to the current time.
- Updated rows get `error_message = "cleared running job by operator"`.
- Other jobs are untouched.
- If no rows are cleared, the command still succeeds.

Successful output:

```json
{
  "jobId": "collect_prices",
  "cleared": 2
}
```

## Tests

Add coverage for:

- Schedule parsing for cron jobs.
- Schedule parsing for manual jobs.
- Missing `schedule` treated as manual.
- Invalid cron expression fails clearly.
- `scheduler start --once` runs a due cron job and writes records.
- `scheduler start --once` records run history through the existing job runner.
- Manual jobs are not auto-run.
- Current-minute policy does not catch up missed older schedules.
- Scheduler skips dispatch when any job is already `running`.
- Failed scheduled job prints a failure event and records a failed run.
- `--poll-interval-ms` validates positive integers.
- `runs clear-running --job-id` marks only that job's running rows failed.
- `runs clear-running --job-id` succeeds when no rows are cleared.

Acceptance coverage should run `init`, configure one cron job with a local collector, run `scheduler start --once`, then verify records and run history.

Required checks:

```bash
npm test
npm run typecheck
git diff --check
```

## AgentRig Breakdown

- Task 1: Add schedule parsing and validation.
- Task 2: Add `scheduler start --once` due-job execution.
- Task 3: Add scheduler loop mode and JSON-line events.
- Task 4: Add `runs clear-running --job-id`.
- Task 5: Add acceptance coverage and README quickstart updates.
- Task 6: Final Phase 5 verification and task cleanup.

## Out Of Scope

- Warehouse sync.
- Retry or backoff policy.
- Daemon manager.
- Persisted `next_run_at`.
- Interval schedule syntax.
- Catch-up execution for missed runs.
- Parallel scheduled job execution.
- Changing manual `run --job` locking behavior.
- Automatic stale-running cleanup.
- Live API smoke tests.
