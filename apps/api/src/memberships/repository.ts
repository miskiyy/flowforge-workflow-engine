import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { memberships, tenants, type UserRole } from '../db/schema.js';

export interface TenantMembership {
  tenantId: string;
  tenantName: string;
  role: UserRole;
}

/** Tenants this user may hold a token for, with the role they carry in each. */
export async function listMembershipsForUser(userId: string): Promise<TenantMembership[]> {
  return db
    .select({ tenantId: memberships.tenantId, tenantName: tenants.name, role: memberships.role })
    .from(memberships)
    .innerJoin(tenants, eq(memberships.tenantId, tenants.id))
    .where(eq(memberships.userId, userId))
    .orderBy(tenants.name);
}

/** The user's role in a tenant, or null if they are not a member — the switch-tenant authorization check. */
export async function getMembershipRole(userId: string, tenantId: string): Promise<UserRole | null> {
  const [row] = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.tenantId, tenantId)));
  return row?.role ?? null;
}

/** Idempotent — signup, seed, and the backfill migration all converge on "user is a member of this tenant". */
export async function ensureMembership(userId: string, tenantId: string, role: UserRole): Promise<void> {
  await db.insert(memberships).values({ userId, tenantId, role }).onConflictDoNothing();
}
