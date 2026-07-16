-- Phase 3.4: a cancelled run is a deliberate stop, not a failure — give it
-- its own terminal status distinct from 'failed'/'timed_out'.

alter table runs drop constraint runs_status_check;
alter table runs add constraint runs_status_check
  check (status in ('pending', 'running', 'succeeded', 'failed', 'timed_out', 'cancelled'));
