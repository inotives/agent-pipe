---
id: task-0036
title: "Phase 7: add Markdown file source ingestion"
type: task
status: done
assigned_to: worker
created_by: human
created_on: 2026-07-08
updated_on: 2026-07-08
priority: normal
parent: ""
depends_on:
  - task-0035
message: "Reviewer accepted: Markdown file source ingestion, H1 title
  extraction, filename fallback, and metadata match Phase 7 task 36."
---







# Task

## Context
Phase 7 supports Markdown text files as simple local research/document records.

Source of truth: `docs/phase-7-file-sources.md`.

## Goal
Implement `file.format: markdown` ingestion through `agent-pipe source run <sourceId>`.

## Scope
- Read Markdown files as UTF-8 text.
- Store one record per Markdown file.
- Produce payload `{ path, title, content }`.
- Derive `title` from the first H1 heading.
- Fall back to the file basename without extension when no H1 exists.
- Use the project-root-relative path in payload and metadata.
- Reuse the same path safety, database routing, all-or-nothing validation, and run history behavior as other file formats.

## Planner Notes
Do not add frontmatter parsing or heading chunking in this phase.

## Implementation Plan
1. Implement Markdown normalization for file sources.
2. Add first-H1 title extraction.
3. Add filename fallback title extraction.
4. Add tests for H1, fallback title, idFields, and metadata.
5. Run required checks.

## Acceptance Criteria

- [ ] Markdown file writes one record.
- [ ] Payload includes `path`, `title`, and `content`.
- [ ] First H1 heading becomes the title.
- [ ] Filename without extension becomes the title when no H1 exists.
- [ ] `idFields: [path]` works for Markdown sources.
- [ ] Markdown metadata includes `ingestionType`, `path`, and `format`.
- [ ] No frontmatter parsing or heading chunking is added.
- [ ] `npm test` passes.
- [ ] `npm run typecheck` passes.
- [ ] `git diff --check` passes.

## Notes
- 2026-07-08: Implemented `file.format: markdown` ingestion through `source run` as one record per file, reusing the existing path safety, database routing, and run-history flow.
- 2026-07-08: Markdown payloads now store `{ path, title, content }`, using the first H1 as `title` and falling back to the filename without extension when no H1 exists.
- 2026-07-08: Added focused coverage for repo sample Markdown ingestion, filename fallback title behavior, `idFields: [path]`, and markdown metadata.
- 2026-07-08: Verified with `npm test -- tests/source-run.test.ts`, `npm run typecheck`, `npm test`, and `git diff --check`.
