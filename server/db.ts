import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Code review 2026-10-06 (the 30 Sep silence): a connection on a dead
// network link used to wait forever, and an idle connection the database
// dropped emitted an 'error' nobody handled, which ends the process. Now
// connections keep alive, no statement or open transaction can hang past its
// limit, and a dropped idle connection is logged and replaced, not fatal.
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  keepAlive: true,
  statement_timeout: 30000,
  query_timeout: 35000,
  idle_in_transaction_session_timeout: 60000,
});
pool.on('error', (err) => {
  console.error('[db] idle connection error (connection dropped and replaced):', err?.message ?? err);
});
export const db = drizzle({ client: pool, schema });
