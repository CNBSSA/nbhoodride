import { Session, check, section, FIXTURES } from "./harness.mjs";

/**
 * Three small rider-app bugs from the product feedback (Festus 2026-09-28):
 * the "dead" Home chip, the sticky booking sheet, and toasts that vanish.
 * The sheet and the toasts are screen behaviour the every-button and layout
 * audits press; this journey proves the server side of the Home chip, which
 * used to answer a rider with nothing at all and so the button did nothing.
 */
export async function run({ base, db }) {
  const admin = new Session(base); await admin.login(FIXTURES.admin.email);
  const fresh = new Session(base); await fresh.csrf();
  const email = `e2e-home-${Date.now()}@example.com`;
  const ids = [];
  try {
    section("Home says what it knows");
    await fresh.req("POST", "/api/auth/signup", { email, password: "Str0ng!Pass123", firstName: "Nne", lastName: "New", phone: "2405550188", termsAccepted: true, privacyAccepted: true });
    const { rows: [user] } = await db.query("SELECT id FROM users WHERE email=$1", [email]);
    ids.push(user.id);
    await admin.req("POST", `/api/admin/users/${user.id}/approve`, {});
    await fresh.login(email, "Str0ng!Pass123");
    const nothing = await fresh.req("POST", "/api/mobility/intent", { utterance: "take me home" });
    check("a rider with no ride yet is told there is no home to go to, not answered with nothing", nothing.status === 200 && nothing.json?.parsed?.intentType === "ride_home" && !nothing.json?.destinationAddress && nothing.json?.reason === "no_home", JSON.stringify(nothing.json));
    const rider = new Session(base); await rider.login(FIXTURES.rider.email);
    const { rows: [hasRide] } = await db.query("SELECT count(*)::int AS n FROM rides WHERE rider_id=$1 AND status='completed' AND pickup_location IS NOT NULL", [FIXTURES.rider.id]);
    const home = await rider.req("POST", "/api/mobility/intent", { utterance: "take me home" });
    if (hasRide.n > 0) {
      check("a rider with rides but no saved home is sent to where the last ride started, and told so", home.json?.source === "last_pickup" && !!home.json?.destinationAddress, JSON.stringify({ s: home.json?.source, d: home.json?.destinationAddress }));
    } else {
      check("a rider with no completed ride is told there is no home", home.json?.reason === "no_home", JSON.stringify(home.json));
    }
    const repeat = await fresh.req("POST", "/api/mobility/intent", { utterance: "same as last time" });
    check("repeat with nothing to repeat has no destination, so the chip can say so", repeat.status === 200 && !repeat.json?.destinationAddress, JSON.stringify(repeat.json));
  } finally {
    await db.query("DELETE FROM mobility_intents WHERE user_id = ANY($1::varchar[])", [ids]).catch(() => {});
    await db.query("DELETE FROM wallet_transactions WHERE user_id = ANY($1::varchar[])", [ids]).catch(() => {});
    await db.query("DELETE FROM users WHERE id = ANY($1::varchar[])", [ids]).catch(() => {});
  }
}
