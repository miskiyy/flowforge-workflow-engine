-- Phase 1: database foundation.
-- Hand-authored (not drizzle-kit generated) to keep the SQL legible for the
-- later EXPLAIN exercise; src/db/schema.ts is the type-safe query-builder
-- source of truth and is kept in lockstep with this file by hand.

-- gen_random_uuid() is built into PostgreSQL core since v13 (postgres:16-alpine
-- here), no pgcrypto extension needed.

-- timestamptz(3) (millisecond precision) everywhere, not the default
-- microsecond precision — JS Date only has millisecond resolution, and a
-- mismatch there silently breaks equality comparisons that round-trip
-- through one (e.g. the created_at-keyed pagination cursor).

create table tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz(3) not null default now()
);

create table users (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  email text not null,
  password_hash text not null,
  role text not null check (role in ('admin', 'editor', 'viewer')),
  created_at timestamptz(3) not null default now(),
  unique (tenant_id, email)
);

create index users_tenant_id_idx on users (tenant_id);

-- current_version_id's foreign key is added below, after workflow_versions
-- exists, since the two tables reference each other.
create table workflow_definitions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  name text not null,
  current_version_id uuid,
  cron_expression text,
  webhook_token uuid,
  deleted_at timestamptz(3),
  created_at timestamptz(3) not null default now(),
  unique (webhook_token)
);

create index workflow_definitions_tenant_id_idx on workflow_definitions (tenant_id);

create table workflow_versions (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references workflow_definitions(id),
  version_number integer not null,
  dag_definition jsonb not null,
  created_by uuid not null references users(id),
  created_at timestamptz(3) not null default now(),
  unique (workflow_id, version_number)
);

alter table workflow_definitions
  add constraint workflow_definitions_current_version_id_fkey
  foreign key (current_version_id) references workflow_versions(id);

-- Deliberately no workflow_id column yet: a run pins an exact
-- workflow_version_id for deterministic audit/replay. workflow_id is added
-- denormalized in a later migration once workflow CRUD lands.
create table runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  workflow_version_id uuid not null references workflow_versions(id),
  trigger_type text not null check (trigger_type in ('manual', 'cron', 'webhook')),
  triggered_by uuid references users(id),
  status text not null check (status in ('pending', 'running', 'succeeded', 'failed', 'timed_out')),
  started_at timestamptz(3),
  finished_at timestamptz(3),
  created_at timestamptz(3) not null default now()
);

create index runs_tenant_id_idx on runs (tenant_id);

-- attempt_number keeps retries as history on one row rather than a row per
-- attempt, so the run graph (one node per DAG step) stays legible.
create table step_runs (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references runs(id),
  step_key text not null,
  attempt_number integer not null default 1,
  status text not null check (status in ('pending', 'running', 'succeeded', 'failed', 'retrying')),
  started_at timestamptz(3),
  finished_at timestamptz(3),
  error text,
  created_at timestamptz(3) not null default now()
);

create index step_runs_run_id_idx on step_runs (run_id);

-- Plain time-indexed table, not partitioned — see Task.md's locked decision
-- against "partitioning theater" for a 4-day MVP. S3/Glacier cold storage +
-- retention is the documented scale path.
create table step_logs (
  id bigserial primary key,
  step_run_id uuid not null references step_runs(id),
  ts timestamptz(3) not null default now(),
  level text not null,
  message text not null
);

create index step_logs_step_run_id_ts_idx on step_logs (step_run_id, ts);
