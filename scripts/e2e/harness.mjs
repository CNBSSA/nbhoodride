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
  const { rows: [prof] } = await db.query("SELECT id FROM driver_profiles WHERE user_id=$1", [FIXTURES.driver.id]);
  await db.query(`INSERT INTO vehicles (driver_profile_id, make, model, year, color, license_plate)
    SELECT $1::varchar,'Toyota','Camry',2020,'Blue','E2E0001' WHERE NOT EXISTS (SELECT 1 FROM vehicles WHERE driver_profile_id=$1::varchar)`, [prof.id]);
}

export async function startServer(env = {}) {
  const port = 5700 + Math.floor(Math.random() * 200);
  const logPath = `/tmp/pgride-e2e-${port}.log`;
  const out = createWriteStream(logPath);
  const child = spawn("node", ["dist/index.js"], {
    env: {
      ...process.env,
      NODE_ENV: "production", PORT: String(port), DATABASE_URL, SESSION_SECRET: "e2e-secret",
      // Production-like: card-only, Stripe armed (unreachable here), email "configured",
      // Telegram + Twilio dummies so every alert/SMS path executes and fails gracefully.
      WALLET_ENABLED: "false", STRIPE_SECRET_KEY: "sk_test_e2e_fake",
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
  async csrf() { await this.req("GET", "/api/csrf"); return this; }
  async login(email, password = PASSWORD) { await this.csrf(); return this.req("POST", "/api/auth/email-login", { email, password }); }
}

export const PICKUP = { lat: 38.9073, lng: -76.7781, address: "Bowie, MD" };
export const DEST = { lat: 38.7823, lng: -77.0166, address: "National Harbor, MD" };
export const uniqueEmail = (tag) => `${tag}-${Date.now()}-${Math.floor(Math.random() * 1e4)}@example.com`;
