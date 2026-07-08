# Phase 7 - File Sources

## Goal

Add local file ingestion as the second real source type after API sources. Phase 7 lets projects ingest JSON, CSV, and Markdown files through the existing `agent-pipe source run <sourceId>` workflow, write records into the selected configured SQLite database, and keep run history in the same database.

Phase 7 stays inside `agent-pipe`. It does not add warehouse sync, file watching, directory crawling, or retrieval chunking.

## Decisions

- Phase 7 adds `type: file` sources.
- File sources use the existing `source run <sourceId>` command.
- File sources write to the source's configured `database`, defaulting to `defaultDatabase`.
- File sources always require explicit `idFields`.
- File ingestion is all-or-nothing: parse and validate the whole file before writing records.
- File ingestion only upserts current rows.
- Missing rows from a later file version are not soft-deleted.
- Upserted rows receive fresh `updated_at` values so downstream consumers can pull latest updated records.
- `file.path` resolves relative to the project root.
- Absolute paths and paths escaping the project root are rejected.
- JSON supports a top-level object or array of objects.
- CSV requires a header row.
- CSV values are stored as strings.
- CSV parsing uses `csv-parse`.
- Markdown stores one file as one record.
- Markdown payload is `{ path, title, content }`.
- Markdown `title` comes from the first H1 heading, falling back to the filename.
- Do not add glob patterns, directory walking, frontmatter parsing, heading chunking, retries, or delete reconciliation in this phase.

## Source Shape

```yaml
sources:
  local_coin_notes:
    type: file
    database: research
    entity: research_note
    idFields:
      - path
    file:
      path: docs/research/bitcoin.md
      format: markdown

  local_coin_rows:
    type: file
    entity: coins_list
    idFields:
      - id
    file:
      path: data/coins.csv
      format: csv

  local_coin_json:
    type: file
    entity: coins_list
    idFields:
      - id
    file:
      path: data/coins.json
      format: json
```

Rules:

- `type` must be `file`.
- `entity` must be a non-empty string.
- `idFields` must be a non-empty list.
- `database` is optional and follows the Phase 6 database-routing rules.
- `file.path` is required.
- `file.format` is required and must be one of `json`, `csv`, or `markdown`.
- Unrelated invalid source configs should not block a selected valid source run, matching API source behavior.

## Format Behavior

JSON:

- Accept a top-level object as one payload.
- Accept a top-level array of objects as many payloads.
- Reject arrays containing non-object items.
- Reject primitive top-level values.

CSV:

- Parse with `csv-parse`.
- Require a header row.
- Convert each row into one payload object.
- Preserve every cell as a string.
- Reject malformed CSV with a clear source-specific error.

Markdown:

- Read the whole file as UTF-8 text.
- Produce one payload:

```json
{
  "path": "docs/research/bitcoin.md",
  "title": "Bitcoin",
  "content": "# Bitcoin\n\n..."
}
```

- Use the first Markdown H1 line as `title`.
- If no H1 exists, use the file basename without extension as `title`.
- Use project-root-relative `file.path` in payload and metadata.

## Run Behavior

File sources reuse the existing source-run persistence model:

- Insert a `job_runs` row with `job_id = sourceId`.
- Parse, normalize, and validate all payloads before writing.
- Build records with the existing `buildRecordRows` behavior.
- Upsert records with `source = sourceId`.
- Mark the run `succeeded` with `records_written` after all writes succeed.
- Mark the run `failed` with the error message when parsing, validation, or writing fails.

Metadata per record should include:

- `ingestionType: "file"`
- `path`
- `format`
- `itemIndex` for JSON array items
- `rowNumber` for CSV rows

## Tests

Add coverage for:

- JSON object file ingestion.
- JSON array file ingestion.
- JSON invalid shape failures.
- CSV ingestion with quoted commas and multiline quoted values.
- CSV malformed file failure.
- Markdown ingestion with first-H1 title.
- Markdown ingestion filename fallback title.
- Explicit `idFields` validation for all formats.
- All-or-nothing behavior when one file row is invalid.
- Database routing for a file source.
- Rejected absolute paths.
- Rejected paths escaping the project root.
- API source behavior remains compatible.

Acceptance coverage should initialize a temp project, configure one JSON source, one CSV source, and one Markdown source, run each source, then verify records and run history through the existing visibility commands.

Required checks:

```bash
npm test
npm run typecheck
git diff --check
```

## AgentRig Breakdown

- Task 1: Add file source config parsing and validation.
- Task 2: Implement JSON file source ingestion.
- Task 3: Add CSV file source ingestion with `csv-parse`.
- Task 4: Add Markdown file source ingestion.
- Task 5: Add all-or-nothing validation, path safety, and database-routing coverage.
- Task 6: Add acceptance coverage and README updates.
- Task 7: Final Phase 7 verification and task cleanup.

## Out Of Scope

- Warehouse sync.
- `market-pipe` changes.
- File watching.
- Glob patterns.
- Directory ingestion.
- Multiple paths per source.
- Markdown heading chunking.
- Markdown frontmatter parsing.
- CSV type inference.
- Delete reconciliation or soft-delete for missing rows.
- Retry policy.
- Source validation command.
