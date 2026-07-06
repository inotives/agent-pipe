---
id: task-0030
title: "Phase 6: update scheduler for per-database execution"
type: task
status: ready
assigned_to: worker
created_by: human
created_on: 2026-07-06
updated_on: 2026-07-06
priority: normal
parent: ""
depends_on:
  - task-0029
message: "Update scheduler execution so jobs targeting different databases may
  run concurrently while same-database due jobs run sequentially in one tick."
---

# Task

## Context
Phase 5 scheduler used one global running-job check. Phase 6 changes this to per-database behavior so independent databases can run at the same scheduled time.

Source of truth: `docs/phase-6-runtime-hardening-multi-db.md`.

## Goal
Implement per-database scheduler locking and same-tick sequencing.

## Scope
- Resolve every due job to its configured database.
- Run due jobs for different databases concurrently.
- Run due jobs for the same database sequentially within the same scheduler tick.
- A running job in one database must not block another database.
- Scheduler job-level JSON events include the database name.
- Preserve no catch-up and no retry behavior.
- Do not add a durable queue.

## Planner Notes
Use the smallest concurrency primitive that keeps tests deterministic. Same-DB sequencing is only within one tick, not persisted queue behavior.

## Implementation Plan
1. Replace global running-job checks with per-database checks.
2. Group due jobs by database for each tick.
3. Execute each database group sequentially.
4. Execute database groups concurrently.
5. Include `database` on job-level scheduler events.
6. Add scheduler tests for cross-DB concurrency and same-DB sequencing.

## Acceptance Criteria

- [ ] Two due jobs targeting different databases can both run in one tick.
- [ ] Two due jobs targeting the same database run sequentially in one tick.
- [ ] A running row in `local` does not block a due job in `research`.
- [ ] A running row in `research` blocks or delays only jobs targeting `research`.
- [ ] Scheduler job-level events include database names.
- [ ] No missed-run catch-up is introduced.
- [ ] No retry behavior is introduced.
- [ ] `npm test` passes.
- [ ] `npm run typecheck` passes.
- [ ] `git diff --check` passes.

## Notes
