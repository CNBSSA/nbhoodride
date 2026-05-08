#!/usr/bin/env node
// Post-implementation audit: verifies that the database schema and the critical
// auth/driver paths are intact after a deploy or migration. Run via
// `npm run audit:post-deploy`. Fails fast (exit 1) on any regression so it can
// be chained into the Railway preDeployCommand.
//
// What it checks:
//   1. Required tables exist.
//   2. Required columns exist on the tables that the registration security
//      hardening commit touched (this was the actual root cause of the driver
//      login / signup regression that prompted this audit step).
//   3. The auth-flow query patterns the server relies on actually execute
//      against the live schema (case-insensitive email lookup, verification
//      token lookup, last-login update, driver profile shell insert+rollback).
//   4. The empty driver-profile-shell insert path works — this is the
//      flow used by the "Become a Driver" button.
//
// Output is human-readable; non-zero exit on any failure.

import pg from 'pg';

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error('AUDIT: DATABASE_URL is not set');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 15000,
});

const REQUIRED_TABLES = [
  'users',
  'driver_profiles',
  'vehicles',
  'rides',
  'sessions',
];

// Columns the application code reads/writes. If any of these is missing the
// signup, login, or driver-profile flow will 500.
const REQUIRED_COLUMNS = {
  users: [
    'id', 'email', 'password', 'first_name', 'last_name', 'phone',
    'is_driver', 'is_admin', 'is_super_admin', 'is_approved', 'is_suspended',
    'virtual_card_balance', 'promo_rides_remaining',
    'password_reset_token', 'password_reset_expiry',
    // Added by the registration security hardening commit — the columns whose
    // absence broke signup and quietly broke login last-login updates.
    'email_verification_token', 'email_verification_expiry', 'email_verified_at',
    'registration_completed_at', 'terms_accepted_at', 'privacy_accepted_at',
    'last_login_at',
    'created_at', 'updated_at',
  ],
  driver_profiles: [
    'id', 'user_id', 'license_number', 'license_image_url', 'insurance_image_url',
    'is_online', 'approval_status', 'accepted_counties',
    'created_at', 'updated_at',
  ],
  vehicles: [
    'id', 'driver_profile_id', 'make', 'model', 'year', 'color', 'license_plate',
    'created_at', 'updated_at',
  ],
};

const results = [];
let failed = 0;

function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failed += 1;
}

async function checkTables(client) {
  const { rows } = await client.query(
    `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ANY($1)`,
    [REQUIRED_TABLES]
  );
  const present = new Set(rows.map(r => r.table_name));
  for (const t of REQUIRED_TABLES) {
    record(`table:${t}`, present.has(t), present.has(t) ? '' : 'missing');
  }
}

async function checkColumns(client) {
  for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
    const { rows } = await client.query(
      `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1`,
      [table]
    );
    const present = new Set(rows.map(r => r.column_name));
    for (const c of columns) {
      record(`column:${table}.${c}`, present.has(c), present.has(c) ? '' : 'missing');
    }
  }
}

async function checkAuthQueryPaths(client) {
  // Case-insensitive email lookup (used by getUserByEmail in storage.ts).
  try {
    await client.query(`SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`, ['nobody@example.invalid']);
    record('query:getUserByEmail (case-insensitive)', true);
  } catch (err) {
    record('query:getUserByEmail (case-insensitive)', false, err.message);
  }

  // Verification token lookup with NOW() filter (getUserByVerificationToken).
  try {
    await client.query(
      `SELECT id FROM users WHERE email_verification_token = $1 AND email_verification_expiry > NOW() LIMIT 1`,
      ['__audit_token_does_not_exist__']
    );
    record('query:getUserByVerificationToken', true);
  } catch (err) {
    record('query:getUserByVerificationToken', false, err.message);
  }

  // updateLastLogin write target.
  try {
    await client.query(
      `UPDATE users SET last_login_at = NOW(), updated_at = NOW()
         WHERE id = '__audit_user_does_not_exist__'`
    );
    record('query:updateLastLogin', true);
  } catch (err) {
    record('query:updateLastLogin', false, err.message);
  }
}

async function checkDriverProfileShellInsert(client) {
  // The "Become a Driver" button POSTs only { userId } to /api/driver/profile.
  // Verify the empty-shell insert succeeds (then roll back so we don't pollute
  // production data).
  await client.query('BEGIN');
  try {
    const u = await client.query(
      `INSERT INTO users (email, first_name, last_name, is_approved)
         VALUES ($1, 'Audit', 'User', true) RETURNING id`,
      [`audit+${Date.now()}@nbhoodride.invalid`]
    );
    const userId = u.rows[0].id;
    await client.query(
      `INSERT INTO driver_profiles (user_id) VALUES ($1)`,
      [userId]
    );
    record('flow:driver_profile_shell_insert', true);
  } catch (err) {
    record('flow:driver_profile_shell_insert', false, err.message);
  } finally {
    await client.query('ROLLBACK');
  }
}

async function run() {
  const client = await pool.connect();
  try {
    console.log('── Post-deploy audit starting ──');
    await checkTables(client);
    await checkColumns(client);
    await checkAuthQueryPaths(client);
    await checkDriverProfileShellInsert(client);
  } finally {
    client.release();
    await pool.end();
  }

  for (const r of results) {
    const mark = r.ok ? 'PASS' : 'FAIL';
    const detail = r.detail ? ` — ${r.detail}` : '';
    console.log(`  [${mark}] ${r.name}${detail}`);
  }

  const total = results.length;
  console.log(`── Audit complete: ${total - failed}/${total} passed ──`);

  if (failed > 0) {
    console.error(`AUDIT FAILED: ${failed} check(s) regressed. See entries marked FAIL above.`);
    process.exit(1);
  }
}

run().catch(err => {
  console.error('AUDIT crashed:', err);
  process.exit(1);
});
