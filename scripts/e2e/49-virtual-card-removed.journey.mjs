import { Session, check, section, FIXTURES } from "./harness.mjs";

/**
 * The Virtual PG Card is gone (work order #451, the Chairman's order of
 * 2026-10-03: "Pg virtual card must go").
 *
 * Riders pay per ride with their card on file; nothing else. There is no
 * top-up, no stored balance offered to a rider, no wallet flag, and no
 * wording that promises one. What stays is the ledger the card shared with
 * drivers' earnings, payouts and refunds — so a driver's balance and the
 * payout request still work. The ride itself (book, accept, complete, card
 * settled) is walked by journeys 01, 07 and 26 on every run; this journey
 * proves the card is absent everywhere a rider or a reviewer could meet it.
 */
export async function run({ base, db }) {
  const visitor = new Session(base); await visitor.csrf();
  const rider = new Session(base); await rider.login(FIXTURES.rider.email);
  const driver = new Session(base); await driver.login(FIXTURES.driver.email);
  const email = `e2e-nocard-${Date.now()}@example.com`;

  try {
    section("The payment config offers no wallet");
    const cfg = await visitor.req("GET", "/api/payment/config");
    check("it answers", cfg.status === 200, `${cfg.status}`);
    check("with no wallet or top-up fields at all", !("walletEnabled" in (cfg.json ?? {})) && !("topUpEnabled" in (cfg.json ?? {})), JSON.stringify(cfg.json));
    check("and card on file still reported", "cardOnFileEnabled" in (cfg.json ?? {}), JSON.stringify(cfg.json));

    section("The top-up doors are gone, not merely closed");
    for (const path of ["/api/virtual-card/topup/create-intent", "/api/virtual-card/topup/confirm"]) {
      const r = await rider.req("POST", path, { amount: 20, paymentIntentId: "pi_x" });
      // Nothing handles it any more: no JSON answer at all (the app's page
      // fallback serves anything unknown), and not the old 403 refusal.
      check(`${path} no longer exists`, r.json === null && r.status !== 403, `${r.status} ${JSON.stringify(r.json)}`);
    }

    section("A new rider is given no stored balance");
    const signup = await visitor.req("POST", "/api/auth/signup", { email, password: "Str0ng!Pass123", firstName: "Ada", lastName: "Cardonly", phone: "2405550149", termsAccepted: true, privacyAccepted: true });
    check("the rider signs up", signup.status === 200, `${signup.status} ${JSON.stringify(signup.json?.message ?? "")}`);
    const { rows: [u] } = await db.query("SELECT id, virtual_card_balance AS bal, promo_rides_remaining AS promos FROM users WHERE email=$1", [email]);
    check("no balance, and the 4 welcome rides ($5 off the card fare) remain", u && Number(u.bal) === 0 && u.promos === 4, JSON.stringify(u));
    const { rows: ledger } = await db.query("SELECT reason FROM wallet_transactions WHERE user_id=$1", [u?.id]);
    check("and no welcome-bonus credit is written to the ledger", ledger.length === 0, JSON.stringify(ledger));

    section("Nothing a reviewer reads promises a prepaid balance");
    const about = await fetch(base + "/about", { headers: { "X-Forwarded-Proto": "https" } });
    const html = await about.text();
    check("the About page says there is no stored value", about.status === 200 && /No stored value or prepaid wallet/.test(html), `${about.status}`);
    check("and never offers to pre-load or top up a balance", !/pre-load|top up|prepaid in-app balance|Virtual PG Card/i.test(html));

    section("Booking without a card is refused, as before");
    await db.query("UPDATE users SET stripe_payment_method_id = NULL WHERE id=$1", [FIXTURES.rider.id]);
    const r = await rider.req("POST", "/api/rides", { pickupLocation: { lat: 38.9073, lng: -76.7781, address: "Bowie, MD" }, destinationLocation: { lat: 38.7823, lng: -77.0166, address: "National Harbor, MD" }, estimatedFare: 12, paymentMethod: "card" });
    check("a rider with no card on file cannot book: there is no balance to fall back on", r.status >= 400 && /payment card/i.test(r.json?.message ?? ""), `${r.status} ${r.json?.message}`);

    section("The ledger drivers are paid from still works");
    const bal = await driver.req("GET", "/api/virtual-card/balance");
    check("a driver's balance is still readable (the driver dashboard and payouts use it)", bal.status === 200 && typeof bal.json?.balance === "number", JSON.stringify(bal.json));
  } finally {
    await db.query("UPDATE users SET stripe_customer_id = 'cus_e2e', stripe_payment_method_id = 'pm_e2e' WHERE id=$1", [FIXTURES.rider.id]).catch(() => {});
    await db.query("DELETE FROM users WHERE email=$1", [email]).catch(() => {});
  }
}
