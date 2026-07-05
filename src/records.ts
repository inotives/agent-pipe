import Database from "better-sqlite3";

export type RecordRow = {
  id: string;
  project_id: string;
  entity: string;
  local_id: string;
  source: string;
  captured_at: string;
  payload_json: string;
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: null;
};

export function buildRecordRows(input: {
  entity: string;
  idFields: string[];
  payloads: Array<Record<string, unknown>>;
  projectId: string;
  source: string;
  idFallbacks?: Record<string, unknown>;
  metadataForPayload?: (payload: Record<string, unknown>, index: number) => Record<string, unknown> | null;
}): Map<string, RecordRow> {
  const rows = new Map<string, RecordRow>();

  for (const [index, payload] of input.payloads.entries()) {
    const localIdValues = input.idFields.map((field) => {
      const value = field in payload ? payload[field] : input.idFallbacks?.[field];
      if (value === undefined) {
        throw new Error(`missing id field "${field}" for entity "${input.entity}"`);
      }
      if (value === null) {
        throw new Error(`id field "${field}" for entity "${input.entity}" cannot be null`);
      }
      if (value === "") {
        throw new Error(`id field "${field}" for entity "${input.entity}" cannot be empty`);
      }
      if (Array.isArray(value) || (typeof value === "object" && value !== null)) {
        throw new Error(`id field "${field}" for entity "${input.entity}" must be a scalar value`);
      }
      return value;
    });

    const localId = JSON.stringify(localIdValues);
    const now = new Date().toISOString();
    const metadata = input.metadataForPayload?.(payload, index) ?? null;
    const id = `${input.projectId}:${input.entity}:${localId}`;
    rows.set(id, {
      id,
      project_id: input.projectId,
      entity: input.entity,
      local_id: localId,
      source: input.source,
      captured_at: now,
      payload_json: JSON.stringify(payload),
      metadata_json: metadata ? JSON.stringify(metadata) : null,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    });
  }

  return rows;
}

export function upsertRecords(database: Database.Database, rows: Iterable<RecordRow>): void {
  const upsert = database.prepare(`
    insert into records (
      id, project_id, entity, local_id, source, captured_at, payload_json,
      metadata_json, created_at, updated_at, deleted_at
    ) values (
      @id, @project_id, @entity, @local_id, @source, @captured_at, @payload_json,
      @metadata_json, @created_at, @updated_at, @deleted_at
    )
    on conflict(id) do update set
      project_id = excluded.project_id,
      entity = excluded.entity,
      local_id = excluded.local_id,
      source = excluded.source,
      captured_at = excluded.captured_at,
      payload_json = excluded.payload_json,
      metadata_json = excluded.metadata_json,
      updated_at = excluded.updated_at,
      deleted_at = excluded.deleted_at
  `);

  const writeAll = database.transaction((items: RecordRow[]) => {
    for (const row of items) {
      upsert.run(row);
    }
  });

  writeAll([...rows]);
}
