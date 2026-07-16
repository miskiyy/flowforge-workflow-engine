import { Type } from '@sinclair/typebox';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import { UnauthorizedError } from '../lib/errors.js';
import { verifyPassword } from '../lib/password.js';

const LoginBody = Type.Object({
  email: Type.String({ format: 'email' }),
  password: Type.String({ minLength: 1 }),
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
}
