import { Session, check, section, FIXTURES, PICKUP, DEST, uniqueEmail } from "./harness.mjs";

/** New rider: signup → blocked until approved → approve → login → card wall → book → schedule. */
export async function run({ base, db }) {
  const email = uniqueEmail("rider");
  const rider = new Session(base, "rider"); await rider.csrf();

  section("Signup");
  const su = await rider.req("POST", "/api/auth/signup", { email, password: "Uitestpass1!", firstName: "New", lastName: "Rider", phone: "2405550177", termsAccepted: true, privacyAccepted: true });
  check("signup accepted", su.status === 200, `${su.status} ${JSON.stringify(su.json?.message)}`);
  check("signup copy never mentions email verification", !/verif/i.test(JSON.stringify(su.json)));
  const noPhone = await rider.req("POST", "/api/auth/signup", { email: uniqueEmail("nophone"), password: "Uitestpass1!", firstName: "No", lastName: "Phone", termsAccepted: true, privacyAccepted: true });
  check("signup without a phone is refused", noPhone.status === 400 && /phone/i.test(noPhone.json?.message), JSON.stringify(noPhone.json?.message));
  const { rows: [u] } = await db.query("SELECT id, is_approved, phone FROM users WHERE email=$1", [email]);
  check("row created, unapproved, phone normalized", u && u.is_approved === false && u.phone === "+12405550177", JSON.stringify(u));

  section("Before approval");
  const pre = await rider.login(email);
  check("login blocked with a pending-approval message (never a verification message)", pre.status === 403 && /approv/i.test(pre.json?.message) && !/verif/i.test(pre.json?.message), `${pre.status} ${JSON.stringify(pre.json?.message)}`);

  section("Approve (one click)");
  const admin = new Session(base, "admin"); check("admin logs in", (await admin.login(FIXTURES.admin.email)).status === 200);
  check("approve", (await admin.req("POST", `/api/admin/users/${u.id}/approve`)).status === 200);

  section("After approval");
  const post = await rider.login(email);
  check("rider logs in with no second step", post.status === 200, `${post.status} ${JSON.stringify(post.json?.message)}`);
  const me = await rider.req("GET", "/api/auth/user");
  check("hasCardOnFile=false for a new rider", me.status === 200 && me.json?.hasCardOnFile === false);

  section("Card wall");
  const noCard = await rider.req("POST", "/api/rides", { pickupLocation: PICKUP, destinationLocation: DEST, estimatedFare: 20, paymentMethod: "card" });
  check("booking without a card → 400 with an add-card instruction", noCard.status === 400 && /card/i.test(noCard.json?.message), JSON.stringify(noCard.json?.message));
  await db.query("UPDATE users SET stripe_customer_id='cus_e2e', stripe_payment_method_id='pm_e2e' WHERE id=$1", [u.id]);
  check("hasCardOnFile=true after adding a card", (await rider.req("GET", "/api/auth/user")).json?.hasCardOnFile === true);

  section("Book and schedule");
  const driver = new Session(base, "driver"); await driver.login(FIXTURES.driver.email);
  await driver.req("POST", "/api/driver/toggle-status", { isOnline: true });
  const ride = await rider.req("POST", "/api/rides", { pickupLocation: PICKUP, destinationLocation: DEST, estimatedFare: 20, paymentMethod: "card" });
  check("immediate ride booked", ride.status === 200, `${ride.status} ${JSON.stringify(ride.json?.message)}`);
  const sch = await rider.req("POST", "/api/rides", { pickupLocation: PICKUP, destinationLocation: DEST, estimatedFare: 20, paymentMethod: "card", scheduledAt: new Date(Date.now() + 5 * 3600e3).toISOString() });
  check("scheduled ride accepted, open to all drivers", sch.status === 200 && !sch.json?.driverId, `${sch.status}`);
  const soon = await rider.req("POST", "/api/rides", { pickupLocation: PICKUP, destinationLocation: DEST, estimatedFare: 20, paymentMethod: "card", scheduledAt: new Date(Date.now() + 3600e3).toISOString() });
  check("too-soon schedule gets the 3-hour message", soon.status === 400 && /3 hours/.test(soon.json?.message));
  section("Revoking approval ends booking now, not at the next logout");
  // 2026-09-16 daily audit: revoke-approval only flipped the flag, and the
  // booking funnel re-checked suspension but never approval — a revoked
  // rider kept booking until they happened to log out. And two doors
  // (multi-stop, shared schedule) went through no re-check at all. All
  // three must refuse with the same words the login gate uses.
  // 2026-09-17 (standard practice): revoking now also ends every session the
  // rider holds, so the same session is signed out outright — 401 at every
  // door — and the booking funnel's own re-check stands behind that.
  const PENDING = /pending approval by an administrator/;
  void PENDING;
  check("revoke", (await admin.req("POST", `/api/admin/users/${u.id}/revoke-approval`)).status === 200);
  const revokedSolo = await rider.req("POST", "/api/rides", { pickupLocation: PICKUP, destinationLocation: DEST, estimatedFare: 20, paymentMethod: "card" });
  check("a revoked rider is signed out on the same session, so the booking door is closed", revokedSolo.status === 401, `${revokedSolo.status} ${JSON.stringify(revokedSolo.json?.message)}`);
  const revokedMulti = await rider.req("POST", "/api/rides/multi-stop", { pickupLocation: PICKUP, destinationLocation: DEST, pickupStops: [PICKUP], estimatedFare: 20 });
  check("nor a multi-stop ride, which used to skip every re-check", revokedMulti.status === 401, `${revokedMulti.status} ${JSON.stringify(revokedMulti.json?.message)}`);
  const revokedGroup = await rider.req("POST", "/api/rides/create-shared-schedule", { pickupLocation: PICKUP, destinationLocation: DEST, estimatedFare: 20, scheduledAt: new Date(Date.now() + 5 * 3600e3).toISOString() });
  check("nor a coworker group, which used to skip every re-check", revokedGroup.status === 401, `${revokedGroup.status} ${JSON.stringify(revokedGroup.json?.message)}`);
  check("and they cannot sign in again while revoked", (await new Session(base).login(email)).status === 403);
  check("re-approve", (await admin.req("POST", `/api/admin/users/${u.id}/approve`)).status === 200);
  check("once re-approved they sign in again", (await rider.login(email)).status === 200);
  const restored = await rider.req("POST", "/api/rides", { pickupLocation: PICKUP, destinationLocation: DEST, estimatedFare: 20, paymentMethod: "card" });
  check("and booking works again the moment approval is restored", restored.status === 200, `${restored.status} ${JSON.stringify(restored.json?.message ?? "")}`);

  const dc = await rider.req("POST", "/api/rides", { pickupLocation: { lat: 38.8977, lng: -77.0365, address: "Washington, DC" }, destinationLocation: DEST, estimatedFare: 20, paymentMethod: "card" });
  check("pickup outside Maryland refused with guidance", dc.status === 400, JSON.stringify(dc.json?.message)?.slice(0, 60));
  await db.query("UPDATE rides SET created_at = created_at - interval '2 hours' WHERE rider_id=$1", [u.id]).catch(() => {});
}
