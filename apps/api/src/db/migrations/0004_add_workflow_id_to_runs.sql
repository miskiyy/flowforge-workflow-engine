-- Phase 6: the required "safe schema alteration" migration.
--
-- runs already carries workflow_version_id (a run pins an exact version for
-- deterministic audit/replay — see 0001_init.sql). But the dashboard's most
-- common read is "show me runs for workflow X", which today means joining
-- through workflow_versions on every request. Denormalizing workflow_id onto
-- runs turns that into a direct filter and is what the tenant_id/workflow_id/
-- status index below needs to actually cover the query.
--
-- Numbered 0004 (not 0002) because 0002/0003 already landed in Phase 3 for
-- step_runs.output/status and the cancelled run status — this is the next
-- migration in sequence, filling the role Task.md calls "migration 0002".

-- 1. Add the column nullable first — existing rows have no value yet, and a
--    NOT NULL column can't be added to a populated table in one step.
alter table runs add column workflow_id uuid;

-- 2. Backfill from the version each existing run already pins. Every run has
--    exactly one workflow_version_id, and every version belongs to exactly
--    one workflow, so this join is total — no run is left null.
update runs
set workflow_id = workflow_versions.workflow_id
from workflow_versions
where workflow_versions.id = runs.workflow_version_id;

-- 3. Now that every row has a value, enforce it going forward.
alter table runs alter column workflow_id set not null;

-- 4. Referential integrity: a run's denormalized workflow_id must point at a
--    real workflow_definitions row.
alter table runs
  add constraint runs_workflow_id_fkey
  foreign key (workflow_id) references workflow_definitions(id);

-- 5. The one justified index for this migration (see query-optimization.md):
--    covers GET /runs?workflowId=X&status=failed exactly — tenant_id first
--    (every query is tenant-scoped), then workflow_id, then status, with
--    created_at DESC last so the existing "newest first" ORDER BY is also
--    satisfied by the index instead of a separate sort.
create index idx_runs_tenant_workflow_status on runs (tenant_id, workflow_id, status, created_at desc);

-- Rollback (not auto-applied — the migration runner is forward-only by
-- design; run this by hand against schema_migrations if this migration ever
-- needs to be reversed):
--
--   drop index idx_runs_tenant_workflow_status;
--   alter table runs drop constraint runs_workflow_id_fkey;
--   alter table runs drop column workflow_id;
--   delete from schema_migrations where name = '0004_add_workflow_id_to_runs.sql';
