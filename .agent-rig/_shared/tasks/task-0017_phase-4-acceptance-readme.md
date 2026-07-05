---
id: task-0017
title: "Phase 4: add acceptance coverage and README job workflow"
type: task
status: ready
assigned_to: worker
created_by: human
created_on: 2026-07-05
updated_on: 2026-07-05
priority: normal
parent: ""
depends_on:
  - task-0016
message: ""
---

# Task

## Context
After manual job execution is implemented, Phase 4 needs end-to-end coverage and README documentation.

## Goal
Add acceptance coverage and README updates for the manual job runner workflow.

## Scope
- Extend acceptance coverage to prove a configured local job can write records and run history.
- Update README with the shortest useful manual job workflow.
- Do not add scheduler docs.
- Do not add live API smoke tests.

## Planner Notes
- Acceptance coverage should run `init`, write a small local collector script, configure a job, run it, verify records through `records list/show`, and verify run history through `runs list/show`.
- Keep README short and operational.

## Implementation Plan
1. Add an end-to-end test with a local collector script that prints JSON to stdout.
2. Verify `jobs list`.
3. Verify `run --job`.
4. Verify records through Phase 3 visibility commands.
5. Verify run history through Phase 3 visibility commands.
6. Update README quickstart.

## Acceptance Criteria

- [ ] Acceptance coverage verifies `jobs list`.
- [ ] Acceptance coverage verifies `run --job`.
- [ ] Acceptance coverage verifies written records through `records list/show`.
- [ ] Acceptance coverage verifies job run history through `runs list/show`.
- [ ] README documents the Phase 4 manual job workflow.
- [ ] `npm test` passes.
- [ ] `npm run typecheck` passes.
- [ ] `git diff --check` passes.

## Notes
