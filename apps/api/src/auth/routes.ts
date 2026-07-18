import { Type } from '@sinclair/typebox';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import { ForbiddenError, UnauthorizedError } from '../lib/errors.js';
import { verifyPassword } from '../lib/password.js';
import { listMembershipsForUser, getMembershipRole } from '../memberships/repository.js';

const LoginBody = Type.Object({
  email: Type.String({ format: 'email' }),
  password: Type.String({ minLength: 1 }),
});

const SwitchTenantBody = Type.Object({
  tenantId: Type.String({ format: 'uuid' }),
});

// Valid bcrypt hash of a value nobody can log in with — compared against on
// a lookup miss so failing on "unknown email" and "wrong password" take the
// same code path/time, instead of leaking which emails exist via timing.
const DUMMY_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEeOgOOnYd5.YnFxJqp5F3vJmZLIt7bZ0Vy';

export function registerAuthRoutes(app: FastifyInstance): void {
  app.post('/auth/login', { schema: { body: LoginBody } }, async (request) => {
    const { email, password } = request.body as { email: string; password: string };

    // email is unique per-tenant (schema: UNIQUE(tenant_id, email)), not
    // globally — this looks up the first match. Fine for the seeded demo
    // data (tenant-scoped email domains), documented as a known limitation
    // for a real multi-tenant signup flow.
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    const passwordValid = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);

    if (!user || !passwordValid) {
      throw new UnauthorizedError('Invalid email or password');
    }

    const accessToken = await app.jwt.sign({
      tenantId: user.tenantId,
      userId: user.id,
      role: user.role,
    });

    return { accessToken };
  });

  // The tenants the current user may switch into (their membership set). Powers
  // the dashboard's org switcher; authenticated by whatever token they hold now.
  app.get('/me/tenants', { preHandler: [app.authenticate] }, async (request) => {
    const tenants = await listMembershipsForUser(request.authUser.userId);
    return { tenants };
  });

  // Issues a fresh token scoped to a different tenant the user is a member of.
  // The role comes from that tenant's membership (role is per-tenant), never
  // from the caller — and non-members are refused, so this can't be used to
  // reach a tenant you don't belong to.
  app.post('/auth/switch-tenant', { schema: { body: SwitchTenantBody }, preHandler: [app.authenticate] }, async (request) => {
    const { tenantId } = request.body as { tenantId: string };
    const role = await getMembershipRole(request.authUser.userId, tenantId);
    if (!role) throw new ForbiddenError('You are not a member of that tenant');

    const accessToken = await app.jwt.sign({ tenantId, userId: request.authUser.userId, role });
    return { accessToken };
  });
}
