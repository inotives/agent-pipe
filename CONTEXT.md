# Agent Pipe

Agent Pipe is a local-first ingestion runner for agent-managed projects. It gives projects a small shared language for capturing records, running jobs, and scheduling local collection without a server.

## Language

**Project**:
A local workspace that owns its own Agent Pipe configuration and data store.
_Avoid_: app, repo, tenant

**Project ID**:
The stable identifier used to separate records from different projects.
_Avoid_: namespace, slug

**Entity**:
A configured record type inside a project, such as `coins_list`.
_Avoid_: table, model, resource

**Source**:
A configured producer of records for an entity. A project may define different sources for different datapoints and ingestion types.
_Avoid_: connector, integration, feed

**Ingestion Type**:
The source category that determines how records are collected, such as API, file, stream, or GraphQL.
_Avoid_: source kind, adapter type

**Record**:
One captured entity item stored with a deterministic identity and JSON payload.
_Avoid_: row, event, document

**Soft-Deleted Record**:
A record whose `deleted_at` value is non-null. Soft-deleted records remain stored but are no longer active.
_Avoid_: removed row, tombstone

**Local ID**:
The entity-specific identifier built from configured `idFields`.
_Avoid_: primary key, external id

**Job**:
A configured command that produces records for one entity.
_Avoid_: task, worker, pipeline

**Schedule**:
The local timing rule that determines when a job is due to run.
_Avoid_: trigger, timer

**Job Run**:
One recorded execution attempt for a job, including status and write count.
_Avoid_: execution, invocation, run log
