---
id: task-0008
title: "Phase 2: persist source records and run status"
type: task
status: ready
assigned_to: worker
created_by: human
created_on: 2026-07-05
updated_on: 2026-07-05
priority: normal
parent: ""
depends_on:
  - task-0007
message: ""
---

# Task

## Context
Managed source execution must be observable in local SQLite and reuse the Phase 1 record store.

## Goal
Persist records and `job_runs` status for `agent-pipe source run <sourceId>`.

## Scope
- Create a `job_runs` row when source execution starts.
- Record `running`, then `succeeded` or `failed`.
- Store run status in local SQLite.
- Store `records_written`.
- Store config, HTTP, parse, and database failures in `error_message`.
- Treat any non-2xx HTTP response as a failed run.
- Do not write records from failed HTTP responses.
- For paginated runs, keep earlier successful page records if a later page fails.
- For later page failures, mark the job `failed` and store `records_written` so far.
- Store the configured source ID in `records.source`.
- Store request metadata in `records.metadata_json`, including URL, status code, fetched timestamp, and ingestion type.
- Before computing record IDs, fill missing `idFields` from static `params` and `query` values in `sources.yaml`.
- Always print compact JSON on success with `sourceId`, `entity`, `recordsWritten`, and `jobRunId`.
- Print errors to stderr and exit non-zero.

## Planner Notes
Avoid rollback machinery for partial paginated writes. The job status is the source of truth for whether the run completed.

## Implementation Plan
1. Wrap source execution with job run creation and final status updates.
2. Reuse the existing deterministic record upsert path where possible.
3. Add tests that inspect SQLite for records, metadata, and job status.

## Acceptance Criteria

- [ ] Successful source runs create a `succeeded` job run row.
- [ ] Failed source runs create or update a `failed` job run row.
- [ ] Successful source runs print compact JSON with `jobRunId`.
- [ ] Source records use `records.source = sourceId`.
- [ ] Record metadata includes request details.
- [ ] Object responses can use id fields filled from configured params/query values.
- [ ] Paginated partial failure keeps earlier records and marks the job failed.
- [ ] `npm test` passes.
- [ ] `npm run typecheck` passes.

## Notes

