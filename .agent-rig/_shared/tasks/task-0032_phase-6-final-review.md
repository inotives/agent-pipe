---
id: task-0032
title: "Phase 6: final verification and task cleanup"
type: task
status: ready
assigned_to: worker
created_by: human
created_on: 2026-07-06
updated_on: 2026-07-06
priority: normal
parent: ""
depends_on:
  - task-0031
message: "Run the final Phase 6 verification pass, confirm docs/tasks match the
  implemented runtime, and leave the repo ready for planner/reviewer commit."
---

# Task

## Context
Phase 6 should finish with implementation, docs, tests, README, and AgentRig task state aligned.

Source of truth: `docs/phase-6-runtime-hardening-multi-db.md`.

## Goal
Run the final Phase 6 verification pass and clean up task statuses/messages.

## Scope
- Verify implementation matches the Phase 6 doc.
- Verify README examples match implemented commands.
- Verify all Phase 6 task statuses and review messages are current.
- Confirm live smoke notes from Task 31 are present.
- Do not introduce new runtime behavior.

## Planner Notes
This is the final gate before committing Phase 6 implementation.

## Implementation Plan
1. Review Phase 6 commands against the phase doc.
2. Review README for stale planned wording.
3. Review Phase 6 task files for status/message drift.
4. Run the full check set.
5. Report any blocker clearly.

## Acceptance Criteria

- [ ] Phase 6 task files reflect the real final status.
- [ ] Phase 6 docs match implemented behavior.
- [ ] README matches implemented behavior.
- [ ] Task 31 live smoke notes are present.
- [ ] `npm test` passes.
- [ ] `npm run typecheck` passes.
- [ ] `git diff --check` passes.
- [ ] No known Phase 6 doc/implementation mismatch remains.

## Notes
