---
id: task-0012
title: "Phase 3: add acceptance coverage and README visibility workflow"
type: task
status: done
assigned_to: worker
created_by: human
created_on: 2026-07-05
updated_on: 2026-07-05
priority: normal
parent: ""
depends_on:
  - task-0010
  - task-0011
message: "Reviewed: acceptance coverage now exercises records list/show and runs
  list/show in real initialized projects, README includes the Phase 3 visibility
  workflow, and npm test plus npm run typecheck and git diff --check passed."
---




# Task

## Context
After records and runs visibility commands exist, Phase 3 needs end-to-end coverage and a short README workflow.

## Goal
Add acceptance coverage and README documentation for the Phase 3 visibility CLI.

## Scope
- Extend acceptance coverage to prove `records list/show` and `runs list/show` against a real initialized `.agent-pipe` project.
- Update README quickstart with the shortest useful visibility workflow.
- Do not add live API smoke tests for Phase 3.
- Do not add scheduler or job runner docs.

## Planner Notes
- Acceptance coverage should run `init`, ingest local records with `put` or `source run`, then verify records and runs visibility commands.
- Use local fixtures/local HTTP server only when source-run data is needed.
- README should stay short and operational.

## Implementation Plan
1. Add end-to-end assertions for the records visibility workflow.
2. Add end-to-end assertions for the runs visibility workflow.
3. Update README quickstart with `records list`, `records show`, `runs list`, and `runs show`.
4. Run the full verification set.

## Acceptance Criteria

- [ ] Acceptance coverage verifies `records list`.
- [ ] Acceptance coverage verifies `records show <id>`.
- [ ] Acceptance coverage verifies `runs list`.
- [ ] Acceptance coverage verifies `runs show <id>`.
- [ ] README documents the Phase 3 visibility workflow.
- [ ] `npm test` passes.
- [ ] `npm run typecheck` passes.
- [ ] `git diff --check` passes.

## Notes
