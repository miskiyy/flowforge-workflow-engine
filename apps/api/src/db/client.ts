import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { env } from '../config.js';
import * as schema from './schema.js';

export const pool = new Pool({ connectionString: env.databaseUrl });
export const db = drizzle(pool, { schema });

/** The transaction handle type passed into `db.transaction(async (tx) => ...)` callbacks. */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
