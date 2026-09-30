/**
 * Journey-test harness: boots the BUILT server against a real Postgres, seeds
 * the three fixture accounts every journey needs, and gives each journey a
 * cookie-jar Session that logs in the way the app does (CSRF double-submit +
 * email login). Assertions go through check() so a single failure anywhere
 * fails the whole run — this is the regression net for "it worked yesterday".
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
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
/** The invitation link the audits open: /org/join/<E2E_INVITE_TOKEN>. Only its hash is stored. */
export const E2E_INVITE_TOKEN = "e2e0" .repeat(12); // 48 hex chars, the shape a real token has
/** The approval link the audits open: /approve/<E2E_APPROVAL_TOKEN>, a held delivery on the business account waiting for the recipient. */
export const E2E_APPROVAL_TOKEN = "e2e1" .repeat(12);
/** The "delivered" link the audits open: /delivered/<E2E_DELIVERED_TOKEN>, a completed parcel on the business account. */
export const E2E_DELIVERED_TOKEN = "e2e2" .repeat(12);
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
  await db.query(`INSERT INTO organization_members (organization_id, user_id, role, created_at) VALUES ('e2e-org', $1, 'owner', NOW()) ON CONFLICT (organization_id, user_id) DO UPDATE SET role='owner', created_at=NOW()`, [FIXTURES.rider.id]);
  // A standing BUSINESS account too, so the desk's parcel door — which only a
  // business or food account has — can be opened by the audits. Its
  // membership is dated a day earlier so /api/org/mine (newest first) keeps
  // the medical account as the default the other checks land on; the audits
  // reach this one by ?org=e2e-biz.
  await db.query(`INSERT INTO organizations (id, name, category, facility_fee, address) VALUES ('e2e-biz', 'E2E Books Expert LLC', 'business', 0.00, $1) ON CONFLICT (id) DO UPDATE SET address=$1`, [JSON.stringify({ lat: 38.9073, lng: -76.7781, address: "Bowie, MD" })]);
  await db.query(`INSERT INTO organization_members (organization_id, user_id, role, created_at) VALUES ('e2e-biz', $1, 'owner', NOW() - interval '1 day') ON CONFLICT (organization_id, user_id) DO UPDATE SET role='owner', created_at=NOW() - interval '1 day'`, [FIXTURES.rider.id]);
  // A standing, approved FLEET account with the rider as owner (reached by the
  // audits at ?org=e2e-fleet; its name sorts after the others, so it is never
  // the portal's default), and a fleet application waiting for PG Ride with
  // the driver as owner, so the admin's Organizations list has one to check.
  // Both reset on every seed.
  const fleetBiz = { legalName: "E2E Fleet Motors LLC", ein: "12-3456789", businessType: "llc" };
  await db.query(`INSERT INTO organizations (id, name, category, status, facility_fee, fleet_details, payout_method, payout_details, contact_phone)
    VALUES ('e2e-fleet', 'E2E Fleet Motors', 'fleet', 'active', 0.00, $1, 'zelle', 'fleet@example.com', '2405550100'),
           ('e2e-fleet-app', 'E2E Fleet Applicant', 'fleet', 'pending', 0.00, $2, 'check', '12 Elm St, Bowie, MD', '2405550101')
    ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status, fleet_details=EXCLUDED.fleet_details, payout_method=EXCLUDED.payout_method, payout_details=EXCLUDED.payout_details, review_note=NULL`,
    [JSON.stringify(fleetBiz), JSON.stringify({ ...fleetBiz, legalName: "E2E Fleet Applicant Inc", ein: "98-7654321", businessType: "corporation" })]).catch((e) => console.log("  (fleet seed) " + String(e?.message ?? e).split("\n")[0]));
  await db.query(`INSERT INTO organization_members (organization_id, user_id, role, created_at) VALUES ('e2e-fleet', $1, 'owner', NOW() - interval '2 days'), ('e2e-fleet-app', $2, 'owner', NOW())
    ON CONFLICT (organization_id, user_id) DO UPDATE SET role='owner'`, [FIXTURES.rider.id, FIXTURES.driver.id]).catch((e) => console.log("  (fleet members seed) " + String(e?.message ?? e).split("\n")[0]));
  // A booking account that applied for itself and waits for PG Ride's check
  // (self-serve applications), owned by the driver fixture so the admin's
  // Organizations list has one to check and the rider's portal default is
  // unchanged. Reset on every seed.
  await db.query(`INSERT INTO organizations (id, name, category, status, facility_fee, business_details, contact_phone)
    VALUES ('e2e-org-app', 'E2E Applicant Clinic', 'medical', 'pending', 4.00, $1, '2405550102')
    ON CONFLICT (id) DO UPDATE SET status='pending', business_details=$1, review_note=NULL`,
    [JSON.stringify({ legalName: "E2E Applicant Clinic LLC", ein: "45-6789012", businessType: "llc" })]).catch((e) => console.log("  (org application seed) " + String(e?.message ?? e).split("\n")[0]));
  await db.query(`INSERT INTO organization_members (organization_id, user_id, role, created_at) VALUES ('e2e-org-app', $1, 'owner', NOW())
    ON CONFLICT (organization_id, user_id) DO UPDATE SET role='owner'`, [FIXTURES.driver.id]).catch((e) => console.log("  (org application member seed) " + String(e?.message ?? e).split("\n")[0]));
  // The approved fleet's cars: one ready (checked, papers in date) and one
  // waiting for PG Ride's check, so the fleet desk and the admin's car review
  // have something to show the audits. Reset on every seed.
  await db.query(`INSERT INTO fleet_cars (id, organization_id, make, model, year, color, seats, license_plate, vin, photos, registration_doc_url, insurance_doc_url, inspection_doc_url, inspection_expires, registration_expires, insurance_expires, review_status, status)
    VALUES ('e2e-fleet-car', 'e2e-fleet', 'Toyota', 'Camry', $1, 'White', 5, 'FLT0001', '4T1BF1FK5CU000001', '["/api/objects/db-upload/00000000-0000-4000-8000-0000000000c1","/api/objects/db-upload/00000000-0000-4000-8000-0000000000c2","/api/objects/db-upload/00000000-0000-4000-8000-0000000000c3","/api/objects/db-upload/00000000-0000-4000-8000-0000000000c4"]'::jsonb, '/api/objects/db-upload/00000000-0000-4000-8000-0000000000c5', '/api/objects/db-upload/00000000-0000-4000-8000-0000000000c5', '/api/objects/db-upload/00000000-0000-4000-8000-0000000000c5', $2, $2, $2, 'approved', 'ready'),
           ('e2e-fleet-car-2', 'e2e-fleet', 'Honda', 'Accord', $1, 'Black', 5, 'FLT0002', '1HGCV1F30LA000002', '["/api/objects/db-upload/00000000-0000-4000-8000-0000000000c1","/api/objects/db-upload/00000000-0000-4000-8000-0000000000c2","/api/objects/db-upload/00000000-0000-4000-8000-0000000000c3","/api/objects/db-upload/00000000-0000-4000-8000-0000000000c4"]'::jsonb, '/api/objects/db-upload/00000000-0000-4000-8000-0000000000c5', '/api/objects/db-upload/00000000-0000-4000-8000-0000000000c5', '/api/objects/db-upload/00000000-0000-4000-8000-0000000000c5', $2, $2, $2, 'pending', 'parked')
    ON CONFLICT (id) DO UPDATE SET review_status=EXCLUDED.review_status, status=EXCLUDED.status, review_note=NULL, driver_user_id=NULL, inspection_expires=$2, registration_expires=$2, insurance_expires=$2, year=$1`,
    [new Date().getUTCFullYear() - 2, new Date(Date.now() + 365 * 86400_000).toISOString()]).catch((e) => console.log("  (fleet car seed) " + String(e?.message ?? e).split("\n")[0]));
  // An open invitation to the medical organization, re-opened on every seed,
  // so the every-button audit can open the join page and press its buttons.
  const inviteHash = createHash("sha256").update(E2E_INVITE_TOKEN).digest("hex");
  await db.query(`INSERT INTO organization_invitations (id, organization_id, email, role, token_hash, invited_by, expires_at, accepted_at, accepted_user_id)
    VALUES ('e2e-invite', 'e2e-org', 'e2e-invitee@example.com', 'requester', $1, $2, NOW() + interval '7 days', NULL, NULL)
    ON CONFLICT (organization_id, email) DO UPDATE SET token_hash=$1, expires_at=NOW() + interval '7 days', accepted_at=NULL, accepted_user_id=NULL`, [inviteHash, FIXTURES.rider.id]);
  // A delivery waiting for the recipient's approval: the approval page and
  // the desk's "Send anyway" / "Copy link" / "Text again" have something to show.
  await db.query(`INSERT INTO rides (id, rider_id, status, pickup_location, destination_location, estimated_fare, payment_method, ride_type, passenger_name, passenger_phone, scheduled_at)
    VALUES ('e2e-held-ride', $1, 'pending', $2, $3, 11.80, 'invoice', 'commercial', 'Tunde Bakare', '3015550177', NOW() + interval '3 hours')
    ON CONFLICT (id) DO UPDATE SET status='pending', driver_id=NULL, scheduled_at=NOW() + interval '3 hours'`,
    [FIXTURES.rider.id, JSON.stringify({ address: "Bowie, MD", lat: 38.9073, lng: -76.7781 }), JSON.stringify({ address: "National Harbor, MD", lat: 38.7823, lng: -77.0166 })]);
  await db.query(`INSERT INTO commercial_jobs (ride_id, organization_id, requester_id, job_number, category, parcel_size, handover, drop_contact, pickup_contact, window_start, window_end, recipient_approval, recipient_approval_token, recipient_fee)
    VALUES ('e2e-held-ride', 'e2e-biz', $1, 990002, 'business', 'small', 'person', $2, $3, NOW() + interval '3 hours', NOW() + interval '5 hours', 'awaiting', $4, 11.80)
    ON CONFLICT (ride_id) DO UPDATE SET recipient_approval='awaiting', recipient_approval_token=$4, recipient_fee=11.80, window_start=NOW() + interval '3 hours', window_end=NOW() + interval '5 hours', recipient_nudged_at=NULL, shop_asked_at=NULL`,
    [FIXTURES.rider.id, JSON.stringify({ name: "Tunde Bakare", phone: "3015550177" }), JSON.stringify({ name: "Mama's Kitchen counter" }), E2E_APPROVAL_TOKEN]).catch((e) => console.log("  (held job seed) " + String(e?.message ?? e).split("\n")[0]));
  // One saved recipient for the business account, so the Recipients tab and
  // the parcel form's picker have something to show the audits.
  await db.query(`INSERT INTO organization_recipients (id, organization_id, name, phone, address, handover, note, created_by, archived_at)
    VALUES ('e2e-recipient', 'e2e-biz', 'Tunde Bakare', '3015550177', $1, 'person', 'Ring the bell twice', $2, NULL)
    ON CONFLICT (id) DO UPDATE SET archived_at=NULL, name='Tunde Bakare', phone='3015550177', address=$1, handover='person', note='Ring the bell twice'`,
    [JSON.stringify({ lat: 38.7823, lng: -77.0166, address: "National Harbor, MD" }), FIXTURES.rider.id]).catch((e) => console.log("  (recipient seed) " + String(e?.message ?? e).split("\n")[0]));
  // A delivered parcel with its proof, so the receiver's page has something to show.
  await db.query(`INSERT INTO rides (id, rider_id, driver_id, status, pickup_location, destination_location, estimated_fare, actual_fare, payment_method, ride_type, passenger_name, completed_at)
    VALUES ('e2e-delivered-ride', $1, $2, 'completed', $3, $4, 11.80, 11.80, 'invoice', 'commercial', 'Tunde Bakare', NOW() - interval '1 hour')
    ON CONFLICT (id) DO UPDATE SET status='completed', completed_at=NOW() - interval '1 hour'`,
    [FIXTURES.rider.id, FIXTURES.driver.id, JSON.stringify({ address: "Bowie, MD", lat: 38.9073, lng: -76.7781 }), JSON.stringify({ address: "National Harbor, MD", lat: 38.7823, lng: -77.0166 })]).catch((e) => console.log("  (delivered ride seed) " + String(e?.message ?? e).split("\\n")[0]));
  await db.query(`INSERT INTO commercial_jobs (ride_id, organization_id, requester_id, job_number, category, parcel_size, handover, drop_contact, pickup_contact, window_start, window_end, proof, proof_share_token)
    VALUES ('e2e-delivered-ride', 'e2e-biz', $1, 990003, 'business', 'small', 'person', $2, $3, NOW() - interval '3 hours', NOW() - interval '1 hour', $4, $5)
    ON CONFLICT (ride_id) DO UPDATE SET proof=$4, proof_share_token=$5`,
    [FIXTURES.rider.id, JSON.stringify({ name: "Tunde Bakare", phone: "3015550177" }), JSON.stringify({ name: "Counter" }), JSON.stringify({ receivedBy: "Tunde Bakare", signedAt: new Date(Date.now() - 3_600_000).toISOString(), signedBy: FIXTURES.driver.id }), E2E_DELIVERED_TOKEN]).catch((e) => console.log("  (delivered seed) " + String(e?.message ?? e).split("\n")[0]));
  const { rows: [prof] } = await db.query("SELECT id FROM driver_profiles WHERE user_id=$1", [FIXTURES.driver.id]);
  await db.query(`INSERT INTO vehicles (driver_profile_id, make, model, year, color, license_plate)
    SELECT $1::varchar,'Toyota','Camry',2020,'Blue','E2E0001' WHERE NOT EXISTS (SELECT 1 FROM vehicles WHERE driver_profile_id=$1::varchar)`, [prof.id]);
  // A listed, qualified PG Ride fleet car and a rental request on it, so the
  // rental page and the admin's Car rental tab have something to show the
  // audits (journey 30 makes its own). Reset on every seed.
  const inAYear = new Date(Date.now() + 365 * 86400_000).toISOString();
  await db.query(`INSERT INTO rental_cars (id, owner_kind, make, model, year, color, seats, license_plate, vin, photos, daily_price, deposit, miles_per_day, extra_mile_fee, late_hour_fee, pickup_location, inspection_expires, registration_expires, insurance_expires, status)
    VALUES ('e2e-rental-car', 'fleet', 'Honda', 'Civic', $1, 'Silver', 5, 'PGR0001', '1HGCM82633A004352', '["/api/objects/db-upload/00000000-0000-4000-8000-0000000000c1","/api/objects/db-upload/00000000-0000-4000-8000-0000000000c2","/api/objects/db-upload/00000000-0000-4000-8000-0000000000c3","/api/objects/db-upload/00000000-0000-4000-8000-0000000000c4"]'::jsonb, 49.00, 200.00, 150, 0.40, 15.00, $2, $3, $3, $3, 'listed')
    ON CONFLICT (id) DO UPDATE SET status='listed', inspection_expires=$3, registration_expires=$3, insurance_expires=$3, year=$1`,
    [new Date().getUTCFullYear() - 2, JSON.stringify({ lat: 38.9073, lng: -76.7781, address: "PG Ride lot, Bowie, MD" }), inAYear]).catch((e) => console.log("  (rental car seed) " + String(e?.message ?? e).split("\n")[0]));
  await db.query(`INSERT INTO rental_bookings (id, car_id, renter_id, starts_at, ends_at, days, daily_price, rental_total, deposit, miles_allowed, status, licence_number, licence_image_url)
    VALUES ('e2e-rental-request', 'e2e-rental-car', $1, NOW() + interval '60 days', NOW() + interval '62 days', 2, 49.00, 98.00, 200.00, 300, 'requested', 'E2E1234567', '/api/objects/db-upload/00000000-0000-4000-8000-0000000000c5')
    ON CONFLICT (id) DO UPDATE SET status='requested', starts_at=NOW() + interval '60 days', ends_at=NOW() + interval '62 days', payment_status='none', payment_error=NULL, charge_intent_id=NULL, deposit_intent_id=NULL`,
    [FIXTURES.rider.id]).catch((e) => console.log("  (rental booking seed) " + String(e?.message ?? e).split("\n")[0]));
  // Renters' facts (industry rules, 2026-09-28): the rider is 36 with a
  // cleared driving record, so their requests can be confirmed; the driver's
  // record is waiting for the desk, so the admin's Renters list has a row.
  await db.query(`INSERT INTO rental_renters (user_id, date_of_birth, licence_number, licence_issued_on, licence_expires_on, licence_image_url, record_status, record_checked_at)
    VALUES ($1, '1990-01-15', 'M123456789', '2010-03-01', '2035-01-15', '/api/objects/db-upload/00000000-0000-4000-8000-0000000000c5', 'cleared', NOW()),
           ($2, '1985-05-05', 'D987654321', '2005-06-01', '2034-05-05', '/api/objects/db-upload/00000000-0000-4000-8000-0000000000c6', 'pending', NULL)
    ON CONFLICT (user_id) DO UPDATE SET date_of_birth=EXCLUDED.date_of_birth, licence_number=EXCLUDED.licence_number, licence_issued_on=EXCLUDED.licence_issued_on,
      licence_expires_on=EXCLUDED.licence_expires_on, record_status=EXCLUDED.record_status, record_checked_at=EXCLUDED.record_checked_at, record_note=NULL`,
    [FIXTURES.rider.id, FIXTURES.driver.id]).catch((e) => console.log("  (renter seed) " + String(e?.message ?? e).split("\n")[0]));
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
      WALLET_ENABLED: "false", STRIPE_SECRET_KEY: "sk_test_e2e_fake", STRIPE_WEBHOOK_SECRET: "whsec_e2e_fake",
      // Commercial riders is off in production until proven; journeys exercise
      // it on. Overridable so the flag-off state — what production actually
      // runs — can be re-proved on demand, not just argued about.
      COMMERCIAL_ENABLED: process.env.COMMERCIAL_ENABLED ?? "true",
      // Car rental likewise: off in production, on for the journeys and audits.
      RENTAL_ENABLED: process.env.RENTAL_ENABLED ?? "true",
      // Fleet management accounts likewise.
      FLEET_ENABLED: process.env.FLEET_ENABLED ?? "true",
      // Email "configured" but pointed at a closed local port: every send path
      // executes and fails at once, and no email can ever leave a test.
      SMTP_HOST: "127.0.0.1", SMTP_PORT: "9", SMTP_USER: "noreply@peoplegoverned.com", SMTP_PASS: "e2e-fake-app-password", EMAIL_FROM: "noreply@peoplegoverned.com",
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
  // Print WHY, here, instead of a path into a runner that no longer exists.
  // Two CI failures were misread as test bugs because the real message —
  // the server never came up — was only in a file nobody could open, and
  // the step output was flooded by container logs.
  let tail = "(no output)";
  try { tail = readFileSync(logPath, "utf8").split("\n").slice(-40).join("\n"); } catch {}
  throw new Error(
    `server did not become healthy after 30s on ${base}\n` +
    `----- last 40 lines of ${logPath} -----\n${tail}\n` +
    `--------------------------------------`);
}
/**
 * Delete rides and every row that references them (audit logs, disputes,
 * readiness events, chat…) so journeys can clean up after themselves on a
 * database that has seen earlier runs.
 */
export async function deleteRides(db, ids) {
  ids = (ids || []).filter(Boolean);
  if (ids.length === 0) return;
  for (const [table, col] of [["commercial_jobs", "ride_id"], ["disputes", "ride_id"], ["emergency_incidents", "ride_id"], ["agent_audit_log", "ride_id"], ["ride_surface_cache", "ride_id"], ["bonus_allocations", "ride_id"], ["agent_action_proposals", "ride_id"], ["l4_readiness_events", "ride_id"], ["lost_found_reports", "ride_id"], ["ride_messages", "ride_id"], ["wallet_transactions", "ride_id"]]) {
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
  await db.query("DELETE FROM organization_recipients WHERE organization_id = ANY($1::varchar[])", [orgIds]).catch(() => {});
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
      body: body === undefined ? undefined : typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body),
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

/** A real 1×1 PNG: what a photo upload looks like to the store's signature check. */
export function tinyPng() {
  return Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
}
/** A real minimal PDF. */
export function tinyPdf() {
  return Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
}
