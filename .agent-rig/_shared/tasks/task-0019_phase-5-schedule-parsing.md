---
id: task-0019
title: "Phase 5: add schedule parsing and validation"
type: task
status: ready
assigned_to: worker
created_by: human
created_on: 2026-07-06
updated_on: 2026-07-06
priority: normal
parent: ""
depends_on: []
message: ""
---

# Task

## Context
Phase 5 adds local scheduler behavior. Before adding `scheduler start`, job config must understand optional schedules.

Source of truth: `docs/phase-5-local-scheduler.md`.

## Goal
Extend job config parsing so jobs can be manual or cron-scheduled.

## Scope
- Extend `.agent-pipe/schedules.yaml` job parsing.
- Support missing `schedule` as manual.
- Support `schedule.type: manual`.
- Support `schedule.type: cron` with required `expression`.
- Validate cron expressions with `cron-parser`.
- Keep existing Phase 4 job config compatibility.
- Add focused parsing tests.

## Planner Notes
Use the smallest shape needed by the phase doc. Do not add persisted scheduler state or interval syntax.

Expected config:

```yaml
jobs:
  collect_prices:
    entity: coins_list
    command: npm run collect:prices
    schedule:
      type: cron
      expression: "5 0 * * *"
```

## Implementation Plan
1. Add the `cron-parser` dependency.
2. Extend the job schema in the schedules module.
3. Normalize missing `schedule` to manual if helpful for callers.
4. Make invalid cron expressions fail clearly.
5. Add tests for cron, manual, missing schedule, and invalid cron.

## Acceptance Criteria

- [ ] `schedule.type: cron` with a valid 5-field expression parses.
- [ ] `schedule.type: manual` parses.
- [ ] Missing `schedule` is treated as manual.
- [ ] Invalid cron expression fails clearly.
- [ ] Existing Phase 4 job configs still parse.
- [ ] No scheduler CLI behavior is added in this task.
- [ ] `npm test` passes.
- [ ] `npm run typecheck` passes.

## Notes
