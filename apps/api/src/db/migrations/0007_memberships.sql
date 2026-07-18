-- User <-> tenant memberships: the switch-able set of tenants a user can hold a
-- token for. Additive — users.tenant_id stays as the home/default tenant that
-- login issues a token for, and no existing tenant-scoped query reads this
-- table. It only gates /auth/switch-tenant and answers "which tenants can I
-- switch to".

create table memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  tenant_id uuid not null references tenants(id),
  role text not null check (role in ('admin', 'editor', 'viewer')),
  created_at timestamptz(3) not null default now(),
  unique (user_id, tenant_id)
);

create index memberships_tenant_id_idx on memberships (tenant_id);

-- Backfill: every existing user becomes a member of their current home tenant
-- with their existing role, so nobody loses access to the tenant they already
-- had. on conflict keeps this migration re-runnable/idempotent.
insert into memberships (user_id, tenant_id, role)
select id, tenant_id, role from users
on conflict (user_id, tenant_id) do nothing;

-- Rollback (forward-only runner — apply by hand if needed):
--   drop table memberships;
--   delete from schema_migrations where name = '0007_memberships.sql';
