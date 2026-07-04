---
id: task-0001
title: "Phase 1: scaffold TypeScript CLI"
type: task
status: ready
assigned_to: worker
created_by: human
created_on: 2026-07-04
updated_on: 2026-07-04
priority: normal
parent: ""
depends_on: []
---


# Task

## Context
Phase 1 starts from a docs-only repo. Build only the CLI skeleton needed by `docs/phase-1-project-skeleton.md`; that document is the source of truth for Phase 1 decisions.

## Goal
Create a minimal TypeScript/npm CLI that can route `init` and `put` commands without implementing persistence yet.

## Scope
- Add `package.json`, TypeScript config, source entrypoint, and npm scripts.
- Set the minimum runtime to Node.js 22 LTS.
- Configure the package as ESM.
- Add a `bin` entry for the future installed `agent-pipe` command.
- Use `commander` for command parsing.
- Include `zod` for config and input validation.
- Include `better-sqlite3` for SQLite access.
- Use Vitest for tests.
- Wire `npm run agent-pipe -- <command>` for local development.
- Add a default test command.
- Add `npm run typecheck` using `tsc --noEmit`.
- Commit `package-lock.json`.
- Ensure generated `.agent-pipe/` project data is gitignored.

## Planner Notes
Do not add scheduler, job runner, dashboard, or server scaffolding in this task.

## Implementation Plan
1. Pick the package/test tooling from the spec.
2. Add the CLI entrypoint and command routing.
3. Make unknown commands fail clearly.

## Acceptance Criteria

- [ ] `npm run agent-pipe -- --help` or equivalent command help works.
- [ ] `npm test` runs successfully.
- [ ] `npm run typecheck` runs successfully.
- [ ] `package-lock.json` is committed.
- [ ] No persistence behavior is implemented beyond stubs needed for routing.

## Notes
