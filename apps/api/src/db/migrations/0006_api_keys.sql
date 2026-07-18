-- Per-tenant API keys (machine auth). The token itself is the credential and
-- names its own tenant, mirroring the workflow webhook-token posture. Only the
-- sha256 hash is stored; the plaintext is returned once at creation. created_by
-- points at a real user so actions taken with a key satisfy the same
-- workflow_versions.created_by FK a JWT-authenticated user would.

create table api_keys (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  created_by uuid not null references users(id),
  label text not null,
  key_hash text not null,
  prefix text not null,
  role text not null check (role in ('admin', 'editor', 'viewer')),
  created_at timestamptz(3) not null default now(),
  last_used_at timestamptz(3),
  revoked_at timestamptz(3)
);

-- Unique so a (astronomically unlikely) hash collision fails loudly at insert
-- rather than letting two keys resolve to one row; also the lookup index used
-- on every API-key authenticated request.
create unique index api_keys_key_hash_unique on api_keys (key_hash);
create index api_keys_tenant_id_idx on api_keys (tenant_id);

-- Rollback (forward-only runner — apply by hand if needed):
--   drop table api_keys;
--   delete from schema_migrations where name = '0006_api_keys.sql';
