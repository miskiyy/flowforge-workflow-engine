-- Phase 3.3: the step executor needs to persist a step's output, and needs
-- a 'skipped' status for steps whose dependency failed — a step must never
-- be left 'pending' forever once an upstream step in its chain has failed.

alter table step_runs add column output jsonb;

alter table step_runs drop constraint step_runs_status_check;
alter table step_runs add constraint step_runs_status_check
  check (status in ('pending', 'running', 'succeeded', 'failed', 'retrying', 'skipped'));
