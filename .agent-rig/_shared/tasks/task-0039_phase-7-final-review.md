---
id: task-0039
title: "Phase 7: final verification and task cleanup"
type: task
status: ready
assigned_to: worker
created_by: human
created_on: 2026-07-08
updated_on: 2026-07-08
priority: normal
parent: ""
depends_on:
  - task-0038
message: "Ready: run final Phase 7 verification and align docs, README, tests, and task state."
---




# Task

## Context
Phase 7 should finish with implementation, docs, tests, README, and AgentRig task state aligned.

Source of truth: `docs/phase-7-file-sources.md`.

## Goal
Run the final Phase 7 verification pass and clean up task statuses/messages.

## Scope
- Verify implementation matches the Phase 7 doc.
- Verify README examples match implemented commands and YAML.
- Verify all Phase 7 task statuses and review messages are current.
- Confirm API source behavior remains compatible.
- Do not introduce new runtime behavior.

## Planner Notes
This is the final gate before committing Phase 7 implementation.

## Implementation Plan
1. Review Phase 7 commands and config against the phase doc.
2. Review README for stale or missing file-source wording.
3. Review Phase 7 task files for status/message drift.
4. Run the full check set.
5. Report any blocker clearly in `## Notes`.

## Acceptance Criteria

- [ ] Phase 7 task files reflect the real final status.
- [ ] Phase 7 docs match implemented behavior.
- [ ] README matches implemented behavior.
- [ ] API source behavior remains compatible.
- [ ] `npm test` passes.
- [ ] `npm run typecheck` passes.
- [ ] `git diff --check` passes.
- [ ] No known Phase 7 doc/implementation mismatch remains.

## Notes
