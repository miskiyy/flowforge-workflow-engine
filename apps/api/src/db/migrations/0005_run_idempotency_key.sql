-- Cron/webhook triggers (Task.md:102): "Idempotency key on trigger + webhook
-- to avoid double-fire on retry." A nullable column plus a partial unique
-- index — manual triggers never set it (unaffected, no index entry created
-- for null keys), so this is purely additive to the existing trigger path.

alter table runs add column idempotency_key text;

-- Partial: only rows that actually carry a key participate in the
-- uniqueness check, so any number of manual-trigger runs (idempotency_key
-- is null) can coexist per workflow.
create unique index runs_workflow_id_idempotency_key_unique
  on runs (workflow_id, idempotency_key)
  where idempotency_key is not null;

-- Rollback (not auto-applied — see 0004's own note on this runner being
-- forward-only by design):
--
--   drop index runs_workflow_id_idempotency_key_unique;
--   alter table runs drop column idempotency_key;
--   delete from schema_migrations where name = '0005_run_idempotency_key.sql';
