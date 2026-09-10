/**
 * Journey-test harness: boots the BUILT server against a real Postgres, seeds
 * the three fixture accounts every journey needs, and gives each journey a
 * cookie-jar Session that logs in the way the app does (CSRF double-submit +
 * email login). Assertions go through check() so a single failure anywhere
 * fails the whole run — this is the regression net for "it worked yesterday".
 */
import { spawn } from "node:child_process";
import { createWriteStream, readFileSync } from "node:fs";
import pg from "pg";
import bcrypt from "bcrypt";

export const DATABASE_URL = process.env.DATABASE_URL || "postgresql://pgride@127.0.0.1:5432/pgride";
export const PASSWORD = "Uitestpass1!";
export const FIXTURES = {
  admin: { id: "e2e-admin", email: "e2e-admin@example.com" },
  rider: { id: "e2e-rider", email: "e2e-rider@example.com" },
  driver: { id: "e2e-driver", email: "e2e-driver@example.com" },
  org: { id: "e2e-org", name: "E2E Dialysis Center" },
};

let failures = 0, passes = 0;
export function check(label, ok, detail = "") {
  if (ok) passes += 1; else failures += 1;
  console.log(`${ok ? "  ✅" : "  ❌"} ${label}${detail ? " — " + detail : ""}`);
  return ok;
}
export function section(title) { console.log(`\n━━ ${title} ━━`); }
export function summary() {
  console.log(`\n${failures === 0 ? "✅" : "❌"} ${passes} passed, ${failures} failed`);
  return failures;
}

export async function connectDb() {
  const db = new pg.Client({ connectionString: DATABASE_URL });
  await db.connect();
  return db;
}

/** Idempotent: admin, approved rider, approved driver with a vehicle. */
export async function seedFixtures(db) {
  const hash = await bcrypt.hash(PASSWORD, 10);
  await db.query(`INSERT INTO users (id,email,password,first_name,last_name,is_approved,is_admin,phone,registration_completed_at)
    VALUES ($1,$2,$3,'Ada','Admin',true,true,'+12405550001',NOW())
    ON CONFLICT (id) DO UPDATE SET password=$3,is_admin=true,is_approved=true,is_suspended=false`, [FIXTURES.admin.id, FIXTURES.admin.email, hash]);
  await db.query(`INSERT INTO users (id,email,password,first_name,last_name,is_approved,phone,registration_completed_at)
    VALUES ($1,$2,$3,'Rae','Rider',true,'+12405550002',NOW())
    ON CONFLICT (id) DO UPDATE SET password=$3,is_approved=true,is_suspended=false,is_driver=false,failed_login_attempts=0,lockout_until=NULL,
      stripe_customer_id='cus_e2e',stripe_payment_method_id='pm_e2e'`, [FIXTURES.rider.id, FIXTURES.rider.email, hash]);
  await db.query(`UPDATE users SET stripe_customer_id='cus_e2e', stripe_payment_method_id='pm_e2e' WHERE id=$1`, [FIXTURES.rider.id]);
  await db.query(`INSERT INTO users (id,email,password,first_name,last_name,is_approved,is_driver,phone,registration_completed_at)
    VALUES ($1,$2,$3,'Sam','Driver',true,true,'+12405550003',NOW())
    ON CONFLICT (id) DO UPDATE SET password=$3,is_driver=true,is_approved=true,is_suspended=false`, [FIXTURES.driver.id, FIXTURES.driver.email, hash]);
  await db.query(`INSERT INTO driver_profiles (user_id, approval_status, is_online) VALUES ($1,'approved',false) ON CONFLICT DO NOTHING`, [FIXTURES.driver.id]);
  // A previous run (the every-button audit as admin, a journey that left the
  // driver online) must not decide whether this driver can go online.
  await db.query(`UPDATE driver_profiles SET approval_status='approved', is_suspended=false, is_online=false, current_location=NULL, badges=ARRAY['medical','delivery']::text[] WHERE user_id=$1`, [FIXTURES.driver.id]);
  // A standing organization with the e2e rider as owner, so the requester
  // portal has something to show the audits (journeys create their own).
  await db.query(`INSERT INTO organizations (id, name, category, facility_fee) VALUES ('e2e-org', 'E2E Dialysis Center', 'medical', 4.00) ON CONFLICT (id) DO NOTHING`);
  await db.query(`INSERT INTO organization_members (organization_id, user_id, role) VALUES ('e2e-org', $1, 'owner') ON CONFLICT (organization_id, user_id) DO UPDATE SET role='owner'`, [FIXTURES.rider.id]);
  const { rows: [prof] } = await db.query("SELECT id FROM driver_profiles WHERE user_id=$1", [FIXTURES.driver.id]);
  await db.query(`INSERT INTO vehicles (driver_profile_id, make, model, year, color, license_plate)
    SELECT $1::varchar,'Toyota','Camry',2020,'Blue','E2E0001' WHERE NOT EXISTS (SELECT 1 FROM vehicles WHERE driver_profile_id=$1::varchar)`, [prof.id]);
}

export async function startServer(env = {}) {
  const port = 5700 + Math.floor(Math.random() * 200);
  const logPath = `/tmp/pgride-e2e-${port}.log`;
  const out = createWriteStream(logPath);
  // Absolute path so the harness works from any cwd (CI, scripts, ad-hoc checks).
  const entry = new URL("../../dist/index.js", import.meta.url).pathname;
  const child = spawn("node", [entry], {
    env: {
      ...process.env,
      NODE_ENV: "production", PORT: String(port), DATABASE_URL, SESSION_SECRET: "e2e-secret",
      // Production-like: card-only, Stripe armed (unreachable here), email "configured",
      // Telegram + Twilio dummies so every alert/SMS path executes and fails gracefully.
      WALLET_ENABLED: "false", STRIPE_SECRET_KEY: "sk_test_e2e_fake",
      // Commercial riders is off in production until proven; journeys exercise it on.
      COMMERCIAL_ENABLED: "true",
      RESEND_API_KEY: "re_e2e_fake", RESEND_FROM: "noreply@peoplegoverned.com",
      TELEGRAM_BOT_TOKEN: "e2e", TELEGRAM_CHAT_ID: "1",
      TWILIO_ACCOUNT_SID: "ACe2e", TWILIO_AUTH_TOKEN: "e2e-auth-token", TWILIO_PHONE_NUMBER: "+18882743045",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(out); child.stderr.pipe(out);
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(base + "/health"); if (r.ok) return { base, child, logPath }; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  child.kill();
  throw new Error(`server did not become healthy; see ${logPath}`);
}
/**
 * Delete rides and every row that references them (audit logs, disputes,
 * readiness events, chat…) so journeys can clean up after themselves on a
 * database that has seen earlier runs.
 */
export async function deleteRides(db, ids) {
  ids = (ids || []).filter(Boolean);
  if (ids.length === 0) return;
  for (const [table, col] of [["commercial_jobs", "ride_id"], ["disputes", "ride_id"], ["emergency_incidents", "ride_id"], ["agent_audit_log", "ride_id"], ["ride_surface_cache", "ride_id"], ["bonus_allocations", "ride_id"], ["agent_action_proposals", "ride_id"], ["l4_readiness_events", "ride_id"], ["lost_found_reports", "ride_id"], ["ride_messages", "ride_id"]]) {
    await db.query(`DELETE FROM ${table} WHERE ${col} = ANY($1::varchar[])`, [ids]).catch(() => {});
  }
  await db.query("UPDATE guardian_links SET active_ride_id=NULL WHERE active_ride_id = ANY($1::varchar[])", [ids]).catch(() => {});
  await db.query("UPDATE sms_booking_sessions SET active_ride_id=NULL WHERE active_ride_id = ANY($1::varchar[])", [ids]).catch(() => {});
  await db.query("DELETE FROM rides WHERE id = ANY($1::varchar[])", [ids]);
}
/**
 * Everything belonging to these organizations: their jobs' rides first (the
 * standing-order sweep may have booked more than the journey listed), then
 * the jobs, the standing orders, the members and the organizations.
 */
export async function deleteOrgs(db, orgIds) {
  orgIds = (orgIds || []).filter(Boolean);
  if (orgIds.length === 0) return;
  const { rows } = await db.query("SELECT ride_id FROM commercial_jobs WHERE organization_id = ANY($1::varchar[])", [orgIds]);
  await db.query("UPDATE commercial_jobs SET statement_id = NULL WHERE organization_id = ANY($1::varchar[])", [orgIds]).catch(() => {});
  await db.query("DELETE FROM commercial_statements WHERE organization_id = ANY($1::varchar[])", [orgIds]).catch(() => {});
  await db.query("DELETE FROM commercial_jobs WHERE organization_id = ANY($1::varchar[])", [orgIds]).catch(() => {});
  await deleteRides(db, rows.map((r) => r.ride_id)).catch(() => {});
  await db.query("DELETE FROM commercial_standing_orders WHERE organization_id = ANY($1::varchar[])", [orgIds]).catch(() => {});
  await db.query("DELETE FROM organization_members WHERE organization_id = ANY($1::varchar[])", [orgIds]).catch(() => {});
  await db.query("DELETE FROM organizations WHERE id = ANY($1::varchar[])", [orgIds]).catch(() => {});
}

export function stopServer(server) { try { server.child.kill(); } catch {} }
export function serverLog(server) { try { return readFileSync(server.logPath, "utf8"); } catch { return ""; } }

export class Session {
  constructor(base, name = "") { this.base = base; this.name = name; this.jar = new Map(); }
  cookieHeader() { return [...this.jar.entries()].map(([k, v]) => `${k}=${v}`).join("; "); }
  absorb(res) {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(";"); const eq = pair.indexOf("=");
      this.jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }
  async req(method, path, body, extraHeaders = {}) {
    const headers = { "X-Forwarded-Proto": "https", Cookie: this.cookieHeader(), ...extraHeaders };
    if (body !== undefined && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
    const csrf = this.jar.get("csrf_token");
    if (csrf) headers["X-CSRF-Token"] = decodeURIComponent(csrf);
    const res = await fetch(this.base + path, {
      method, headers,
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
    this.absorb(res);
    let json = null; try { json = await res.json(); } catch {}
    return { status: res.status, json };
  }
  /** Same session, raw body: for CSV and HTML responses. */
  async text(method, path) {
    const headers = { "X-Forwarded-Proto": "https", Cookie: this.cookieHeader() };
    const csrf = this.jar.get("csrf_token");
    if (csrf) headers["X-CSRF-Token"] = decodeURIComponent(csrf);
    const res = await fetch(this.base + path, { method, headers });
    this.absorb(res);
    return { status: res.status, text: await res.text(), type: res.headers.get("content-type") ?? "" };
  }
  async csrf() { await this.req("GET", "/api/csrf"); return this; }
  async login(email, password = PASSWORD) { await this.csrf(); return this.req("POST", "/api/auth/email-login", { email, password }); }
}

export const PICKUP = { lat: 38.9073, lng: -76.7781, address: "Bowie, MD" };
export const DEST = { lat: 38.7823, lng: -77.0166, address: "National Harbor, MD" };
export const uniqueEmail = (tag) => `${tag}-${Date.now()}-${Math.floor(Math.random() * 1e4)}@example.com`;
