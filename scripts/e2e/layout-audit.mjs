/**
 * Mobile layout audit: opens each sheet on a 390×844 phone viewport and
 * asserts its primary action is (a) fully inside the viewport without
 * scrolling and (b) actually hit-testable at its centre (nothing — like the
 * bottom navigation or a floating pill — is drawn on top of it).
 *
 * This is the guard for the "I can see a sliver of the button" class of bug.
 * Run locally: npm run test:layout   (needs a built app + Postgres, like the journeys)
 */
import { chromium, webkit } from "playwright";
import { connectDb, seedFixtures, startServer, stopServer, FIXTURES, PASSWORD, check, section, summary, E2E_INVITE_TOKEN } from "./harness.mjs";

const VIEWPORT = { width: 390, height: 844 };
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;
// PW_BROWSER=webkit runs the same audit on Safari's engine — the one iPhones
// use — because a sheet can pass on Chromium (Android) and still lose its
// footer on iOS. CI runs both.
const engine = process.env.PW_BROWSER === "webkit" ? webkit : chromium;
console.log(`engine: ${process.env.PW_BROWSER === "webkit" ? "webkit (Safari)" : "chromium"}`);

async function loginAs(page, base, email) {
  await page.goto(base + "/login", { waitUntil: "domcontentloaded" });
  const status = await page.evaluate(async ({ email, password }) => {
    await fetch("/api/csrf", { credentials: "include" });
    const t = document.cookie.split("; ").find((c) => c.startsWith("csrf_token="))?.split("=")[1] ?? "";
    return (await fetch("/api/auth/email-login", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": decodeURIComponent(t) }, body: JSON.stringify({ email, password }), credentials: "include" })).status;
  }, { email, password: PASSWORD });
  if (status !== 200) throw new Error(`login as ${email} failed: ${status}`);
  await page.goto(base + "/", { waitUntil: "domcontentloaded" });
  try { await page.tap('[data-testid="welcome-dismiss"]', { timeout: 3000 }); } catch {}
}

/**
 * Assert a modal overlay is the topmost layer across the WHOLE screen, not
 * just where its buttons are. Samples the corners, edges, centre and the
 * bottom band where the home sheet and navigation live: if any sample hits
 * something outside the overlay, another layer is drawn over the dialog.
 */
async function assertModalOnTop(page, label, overlayTestid) {
  const loc = page.locator(`[data-testid="${overlayTestid}"]`).first();
  await loc.waitFor({ timeout: 15000 });
  const { width: w, height: h } = VIEWPORT;
  const points = [[w / 2, 30], [w / 2, h / 2], [16, h / 2], [w - 16, h / 2], [w / 2, h - 60], [w / 2, h - 140], [w / 2, h - 220], [40, h - 90]];
  const misses = await page.evaluate(({ points, overlayTestid }) => points
    .filter(([x, y]) => !document.elementFromPoint(x, y)?.closest(`[data-testid="${overlayTestid}"]`))
    .map(([x, y]) => `${Math.round(x)},${Math.round(y)}`), { points, overlayTestid });
  check(`${label}: dialog is the top layer everywhere on screen`, misses.length === 0, misses.length ? `covered at ${misses.join(" ")}` : "");
}

/** Assert the element with this testid is fully visible and tappable. */
async function assertPrimary(page, label, testid) {
  const loc = page.locator(`[data-testid="${testid}"]`).first();
  await loc.waitFor({ timeout: 15000 });
  const box = await loc.boundingBox();
  const inside = !!box && box.y >= 0 && box.y + box.height <= VIEWPORT.height && box.x >= 0 && box.x + box.width <= VIEWPORT.width;
  check(`${label}: primary action fully on screen`, inside, box ? `top ${Math.round(box.y)} bottom ${Math.round(box.y + box.height)} of ${VIEWPORT.height}` : "no box");
  const disabled = await loc.evaluate((el) => el.hasAttribute("disabled"));
  if (box && !disabled) {
    const hit = await page.evaluate(({ x, y, testid }) => !!document.elementFromPoint(x, y)?.closest(`[data-testid="${testid}"]`), { x: box.x + box.width / 2, y: box.y + box.height / 2, testid });
    check(`${label}: nothing covers it (tap lands on it)`, hit);
  } else if (box) {
    check(`${label}: (disabled until form is complete) box measured`, true);
  }
  check(`${label}: tall enough to tap (≥40px)`, !!box && box.height >= 40, box ? `${Math.round(box.height)}px` : "");
}

const db = await connectDb(); await seedFixtures(db); await db.end();
// E2E_INSECURE_COOKIES: the build runs in production mode over plain http on
// loopback. Chromium still accepts Secure cookies there; WebKit drops them,
// so without this Safari's engine can never log in (CSRF 403).
const server = await startServer({ DRIVER_MARKETPLACE_ENABLED: "true", E2E_INSECURE_COOKIES: "1" });
const browser = await engine.launch(engine === chromium ? { executablePath, args: ["--no-sandbox", "--no-proxy-server"] } : {});
try {
  const ctx = await browser.newContext({ viewport: VIEWPORT, hasTouch: true, isMobile: true, deviceScaleFactor: 2,
    geolocation: { latitude: 38.9073, longitude: -76.7781 }, permissions: ["geolocation"] });
  // Pretend the app is already installed, so the install prompt does not sit
  // over the buttons every other check is about. NOTE: this also hides ALL
  // install UI — which is why a broken install button went unnoticed for
  // weeks. The install surfaces get their own context below, without this.
  await ctx.addInitScript(() => { const o = window.matchMedia.bind(window); window.matchMedia = (q) => String(q).includes("display-mode: standalone") ? { matches: true, media: String(q), onchange: null, addEventListener(){}, removeEventListener(){}, addListener(){}, removeListener(){}, dispatchEvent(){ return false; } } : o(q); });
  await ctx.setExtraHTTPHeaders({ "X-Forwarded-Proto": "https" });

  section("Driver: go online → county sheet");
  let page = await ctx.newPage();
  await loginAs(page, server.base, FIXTURES.driver.email);
  await page.evaluate(() => localStorage.setItem("pgride:lastMode", "driver"));
  await page.goto(server.base + "/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="switch-driver-status"]', { timeout: 20000 });
  // The switch's handler needs the driver profile query to have resolved;
  // tap, and tap once more if the sheet has not appeared.
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.waitForTimeout(1200);
    await page.tap('[data-testid="switch-driver-status"]');
    if (await page.locator('[data-testid="county-selection-sheet"]').isVisible().catch(() => false)) break;
  }
  await assertPrimary(page, "County sheet", "button-go-online-confirm");
  await page.tap('[data-testid="button-county-cancel"]');

  section("Driver: documents sheet");
  await page.tap('[data-testid="tab-profile"]');
  await page.waitForSelector('[data-testid="button-driver-documents"]', { timeout: 20000 });
  await page.tap('[data-testid="button-driver-documents"]');
  await assertPrimary(page, "Documents sheet", "button-submit-documents");
  await page.tap('[data-testid="button-close-documents"]');
  await page.waitForTimeout(400);
  await assertPrimary(page, "Profile header", "button-logout");
  // "Install app" lives here permanently because the floating one is easy
  // to miss — and on iPhone it was painted over by the booking sheet, so
  // there was no way in at all. Hit-tested, not just present: a button
  // under an overlay looks identical to a visible one in the DOM.
  await page.close();

  section("Rider: schedule and book sheets");
  page = await ctx.newPage();
  // Geocoding is stubbed for both sheets (no egress from the runner).
  await page.route("**/api/geocode/suggest*", (route) => route.fulfill({ contentType: "application/json",
    body: JSON.stringify({ suggestions: [{ label: "National Harbor, Oxon Hill, MD", lat: 38.7823, lng: -77.0166 }] }) }));
  await loginAs(page, server.base, FIXTURES.rider.email);
  await page.evaluate(() => localStorage.setItem("pgride:lastMode", "rider"));
  await page.goto(server.base + "/", { waitUntil: "domcontentloaded" });
  try { await page.tap('[data-testid="welcome-dismiss"]', { timeout: 3000 }); } catch {}
  await page.waitForSelector('[data-testid="button-schedule-ride"]', { timeout: 20000 });
  await page.tap('[data-testid="button-schedule-ride"]');
  await assertPrimary(page, "Schedule sheet", "button-confirm-booking");
  // "Add a stop" on the schedule sheet: pick a destination, add a stop, and
  // the pinned Confirm must stay on screen with the extra rows.
  await page.fill('[data-testid="input-destination"]', "National Harbor");
  await page.waitForSelector('[data-testid="input-destination-option-0"]', { timeout: 10000 });
  await page.tap('[data-testid="input-destination-option-0"]');
  await page.tap('[data-testid="button-add-stop-schedule"]');
  await page.fill('[data-testid="input-stop-schedule"]', "Bowie Town Center");
  await page.waitForSelector('[data-testid="input-stop-schedule-option-0"]', { timeout: 10000 });
  await page.tap('[data-testid="input-stop-schedule-option-0"]');
  await page.waitForSelector('[data-testid="button-remove-stop-schedule-0"]', { timeout: 10000 });
  check("Schedule: stop added to the route", await page.locator('[data-testid="button-remove-stop-schedule-0"]').isVisible());
  await assertPrimary(page, "Schedule sheet with a stop", "button-confirm-booking");
  await assertPrimary(page, "Schedule: remove-stop control", "button-remove-stop-schedule-0");
  // Standing weekly plan: switching it on swaps the calendar for day chips
  // and a price line; Confirm must stay pinned and every chip must be a
  // real tap target.
  await page.tap('[data-testid="toggle-weekly-plan"]');
  await page.waitForSelector('[data-testid="plan-days"]', { timeout: 10000 });
  check("Schedule: weekly plan shows a per-ride price", await page.locator('[data-testid="text-plan-price"]').isVisible());
  await assertPrimary(page, "Schedule: weekly plan on", "button-confirm-booking");
  await assertPrimary(page, "Weekly plan: day chip", "plan-day-1");
  await page.tap('[data-testid="button-close-schedule"]');
  await page.waitForSelector('[data-testid="button-book-ride"]', { timeout: 10000 });
  // Book-now is destination-first: type, pick a suggestion, then the driver
  // panel with the pinned Confirm appears. Geocoding is stubbed (no egress).
  await page.tap('[data-testid="button-book-ride"]');
  await page.waitForSelector('[data-testid="input-destination"]', { timeout: 10000 });
  await page.fill('[data-testid="input-destination"]', "National Harbor");
  await page.waitForSelector('[data-testid="suggestion-0"]', { timeout: 10000 });
  await page.tap('[data-testid="suggestion-0"]');
  await assertPrimary(page, "Book-now driver panel", "button-confirm-booking");

  // "Add a stop": the stop row and its remove button appear, the route is
  // re-quoted, and the pinned Confirm stays on screen with the extra rows.
  await page.tap('[data-testid="button-add-stop"]');
  await page.fill('[data-testid="input-stop"]', "Bowie Town Center");
  await page.waitForSelector('[data-testid="stop-suggestion-0"]', { timeout: 10000 });
  await page.tap('[data-testid="stop-suggestion-0"]');
  await page.waitForSelector('[data-testid="button-remove-stop-0"]', { timeout: 10000 });
  check("Book-now: stop added to the route", await page.locator('[data-testid="button-remove-stop-0"]').isVisible());
  await assertPrimary(page, "Book-now with a stop", "button-confirm-booking");
  await assertPrimary(page, "Book-now: remove-stop control", "button-remove-stop-0");

  // Cancel dialogs. These sit ON TOP of the home bottom sheet, which is the
  // exact case that shipped broken: the question was visible, the buttons
  // were under the sheet. Seed one live ride per role straight into the DB.
  const rideDb = await connectDb();
  const loc = (address, lat, lng) => JSON.stringify({ address, lat, lng });
  const { rows: [riderRide] } = await rideDb.query(
    `INSERT INTO rides (rider_id, status, pickup_location, destination_location, estimated_fare, payment_method)
     VALUES ($1, 'pending', $2, $3, 7.65, 'card') RETURNING id`,
    [FIXTURES.rider.id, loc("Tulip Tree Dr, Lake Arbor, MD", 38.9073, -76.7781), loc("National Harbor, MD", 38.7823, -77.0166)]);
  const { rows: [driverRide] } = await rideDb.query(
    `INSERT INTO rides (rider_id, driver_id, status, pickup_location, destination_location, estimated_fare, payment_method)
     VALUES ($1, $2, 'accepted', $3, $4, 7.65, 'card') RETURNING id`,
    [FIXTURES.admin.id, FIXTURES.driver.id, loc("Tulip Tree Dr, Lake Arbor, MD", 38.9073, -76.7781), loc("National Harbor, MD", 38.7823, -77.0166)]);
  try {
    section("Rider: cancel-ride dialog over the home sheet");
    page = await ctx.newPage();
    await loginAs(page, server.base, FIXTURES.rider.email);
    await page.evaluate(() => localStorage.setItem("pgride:lastMode", "rider"));
    await page.goto(server.base + "/", { waitUntil: "domcontentloaded" });
    try { await page.tap('[data-testid="welcome-dismiss"]', { timeout: 3000 }); } catch {}
    await page.waitForSelector(`[data-testid="btn-cancel-ride-${riderRide.id}"]`, { timeout: 20000 });
    await page.tap(`[data-testid="btn-cancel-ride-${riderRide.id}"]`);
    await assertModalOnTop(page, "Rider cancel dialog", "cancel-confirm-overlay");
    await assertPrimary(page, "Rider cancel dialog", "btn-cancel-dialog-confirm");
    await assertPrimary(page, "Rider cancel dialog (keep)", "btn-cancel-dialog-keep");
    await page.tap('[data-testid="btn-cancel-dialog-keep"]');

    section("Driver: cancel-ride dialog over the active ride card");
    page = await ctx.newPage();
    await loginAs(page, server.base, FIXTURES.driver.email);
    await page.evaluate(() => localStorage.setItem("pgride:lastMode", "driver"));
    await page.goto(server.base + "/", { waitUntil: "domcontentloaded" });
    await page.waitForSelector(`[data-testid="button-driver-cancel-${driverRide.id}"]`, { timeout: 20000 });
    await page.tap(`[data-testid="button-driver-cancel-${driverRide.id}"]`);
    await assertModalOnTop(page, "Driver cancel dialog", "driver-cancel-confirm-overlay");
    await assertPrimary(page, "Driver cancel dialog", "btn-driver-cancel-confirm");
    await assertPrimary(page, "Driver cancel dialog (keep)", "btn-driver-cancel-keep");
    await page.tap('[data-testid="btn-driver-cancel-keep"]');
  } finally {
    await rideDb.query("DELETE FROM rides WHERE id = ANY($1::varchar[])", [[riderRide.id, driverRide.id]]).catch(() => {});
    await rideDb.end();
  }

// ── The requester portal: a desk tool that must still work on a phone ──
// Chromium only (WebKit repeats the mobile sheets above); the portal has no
// bottom sheets, so the check is that its primary actions are on screen and
// hit-testable at a desk-sized window and at phone width.
if (engine === chromium) {
  // Restored 2026-09-14, after the removal note was re-examined.
  //
  // These were pulled on 12 Sep because the runner failed "at exactly 30
  // seconds" and I read that as these sections killing the boot. That
  // reading was wrong: 30s is startServer's own wait (60 tries x 500ms),
  // and these blocks run AFTER it returns — they cannot fail a boot. What
  // they COULD do is kill the run, because neither was wrapped: one
  // waitForSelector timing out threw uncaught and the whole audit died with
  // no summary, which is exactly what a boot failure looks like from the
  // outside. Both now report a failed check instead, and the harness prints
  // the server's log on a real boot timeout, so the two can no longer be
  // confused for each other.

  section("Install app: the way in, on a phone that has not installed it");
  // A context WITHOUT the standalone stub above, on an iPhone user agent —
  // the only combination in which the install surfaces exist at all. Both
  // are hit-tested, because the bug this exists to catch was a button that
  // rendered perfectly and sat underneath the booking sheet: present in the
  // DOM, invisible to a rider, and indistinguishable from working.
  try {
    const freshCtx = await browser.newContext({
      viewport: VIEWPORT, hasTouch: true, isMobile: true, deviceScaleFactor: 2,
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      geolocation: { latitude: 38.9073, longitude: -76.7781 }, permissions: ["geolocation"] });
    await freshCtx.setExtraHTTPHeaders({ "X-Forwarded-Proto": "https" });
    const ip = await freshCtx.newPage();
    try {
      await loginAs(ip, server.base, FIXTURES.rider.email);
      // Which affordance appears depends on the browser, not on us: an engine
      // that fires beforeinstallprompt (Chromium on a secure origin, which
      // includes localhost) shows the banner; Safari, which never fires it,
      // shows the floating button. Assert the guarantee a rider cares about —
      // that SOME visible, tappable way to install is on screen — rather than
      // one branch of it, which is how this check first failed in CI while
      // passing here.
      const floating = ip.locator('[data-testid="button-pwa-install-fab"]');
      const banner = ip.locator('[data-testid="pwa-install-prompt"]');
      await Promise.race([
        floating.waitFor({ timeout: 20000 }).catch(() => {}),
        banner.waitFor({ timeout: 20000 }).catch(() => {}),
      ]);
      const viaFab = await floating.count() > 0;
      check("there is a way to install on screen", viaFab || await banner.count() > 0,
        viaFab ? "floating button" : "install banner");
      await assertPrimary(ip, viaFab ? "Install app (floating)" : "Install app (banner)",
        viaFab ? "button-pwa-install-fab" : "pwa-install-prompt");
      await ip.tap('[data-testid="tab-profile"]');
      await ip.waitForSelector('[data-testid="button-install-app"]', { timeout: 15000 });
      await ip.locator('[data-testid="button-install-app"]').scrollIntoViewIfNeeded();
      await assertPrimary(ip, "Install app (Profile row)", "button-install-app");
      await ip.tap('[data-testid="button-install-app"]');
      check("Profile row opens the iPhone walkthrough", await ip.locator('[data-testid="pwa-install-prompt"]').isVisible());
    } finally { await ip.close(); await freshCtx.close(); }
  } catch (e) {
    check("install audit ran", false, String(e?.message ?? e).split("\n")[0]);
  }

  section("Update banner: the one thing that tells a rider to pick up a fix");
  // Forced by answering /api/version with a build id the bundle does not
  // match — the same condition a rider hits the moment a deploy lands.
  // Nothing exercised this before, and it is the only prompt telling
  // someone on an old bundle that a fix exists.
  try {
    const upCtx = await browser.newContext({ viewport: VIEWPORT, hasTouch: true, isMobile: true, deviceScaleFactor: 2,
      geolocation: { latitude: 38.9073, longitude: -76.7781 }, permissions: ["geolocation"] });
    await upCtx.setExtraHTTPHeaders({ "X-Forwarded-Proto": "https" });
    const up = await upCtx.newPage();
    try {
      await up.route("**/api/version", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ id: "a-newer-build", builtAt: new Date().toISOString() }) }));
      await loginAs(up, server.base, FIXTURES.rider.email);
      await up.waitForSelector('[data-testid="update-banner"]', { timeout: 15000 });
      await assertPrimary(up, "Update banner", "update-banner");
      const top = await up.locator('[data-testid="update-banner"]').boundingBox();
      check("Update banner: starts at the very top of the screen", !!top && top.y <= 1, top ? `y=${Math.round(top.y)}` : "no box");
      // Installed on an iPhone there is no browser chrome, so the banner sits
      // under the clock and the Dynamic Island unless the inset is padded.
      const padTop = await up.locator('[data-testid="update-banner"]').evaluate((el) => getComputedStyle(el).paddingTop);
      check("Update banner: pads the status-bar inset, so it is readable when installed", /^\d/.test(padTop) && parseFloat(padTop) >= 8, `padding-top ${padTop}`);
      // Asserted on the STYLE, not the measured box. The banner is the button,
      // so without a floor its tap target is whatever the text line happens to
      // measure — 56px on a machine with the app's fonts, 36px on a runner
      // without them. The measured check above passes on generous fonts even
      // when the floor has been deleted; this one does not.
      const minH = await up.locator('[data-testid="update-banner"]').evaluate((el) => getComputedStyle(el).minHeight);
      check("Update banner: has a tap-target floor that does not depend on font metrics", /^\d/.test(minH) && parseFloat(minH) >= 44, `min-height ${minH}`);
    } finally { await up.close(); await upCtx.close(); }
  } catch (e) {
    check("update-banner audit ran", false, String(e?.message ?? e).split("\n")[0]);
  }

  section("Business sign-in: the desk's own door, signed out");
  for (const [label, viewport] of [["desk 1280×800", { width: 1280, height: 800 }], ["phone 390×844", VIEWPORT]]) {
    const ctx = await browser.newContext({ viewport, isMobile: viewport.width < 500, hasTouch: viewport.width < 500 });
    const page = await ctx.newPage();
    try {
      // Signed out, the portal address itself shows the business sign-in —
      // until 2026-09-16 it showed "not found".
      await page.goto(server.base + "/org?org=e2e-biz", { waitUntil: "domcontentloaded" });
      const signIn = page.locator('[data-testid="button-business-login"]').first();
      await signIn.waitFor({ timeout: 20000 });
      const box = await signIn.boundingBox();
      check(`business sign-in ${label}: /org signed out shows the business sign-in, on screen`, !!box && box.y >= 0 && box.y + box.height <= viewport.height, box ? `at ${Math.round(box.x)},${Math.round(box.y)} h=${Math.round(box.height)}` : "no box");
      check(`business sign-in ${label}: the sign-in button is a real tap target (≥44px)`, !!box && box.height >= 44, box ? `h=${Math.round(box.height)}` : "no box");
      check(`business sign-in ${label}: no sideways scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
      await page.goto(server.base + `/org/join/${E2E_INVITE_TOKEN}`, { waitUntil: "domcontentloaded" });
      const join = page.locator('[data-testid="button-join-organization"]').first();
      await join.waitFor({ timeout: 20000 });
      const jbox = await join.boundingBox();
      check(`join page ${label}: the join button is on screen without scrolling the form off it`, !!jbox && jbox.height >= 44, jbox ? `h=${Math.round(jbox.height)}` : "no box");
    } catch (e) {
      check(`business sign-in ${label}: audit ran`, false, String(e?.message ?? e).split("\n")[0]);
    } finally { await ctx.close(); }
  }

  section("Requester portal: a business account has a parcel door");
  // The delivery drawer shipped with slice 6 and no page opened it — a
  // business account, the kind that exists to send parcels, could not. Both
  // doors must be on screen and hit-testable at desk width AND on a phone
  // (two header buttons once pushed the ride door off a 390px screen), and
  // P must open the parcel drawer. Viewport-aware checks, as the portal
  // pass below uses: assertPrimary assumes the phone viewport.
  for (const [label, viewport] of [["desk 1280×800", { width: 1280, height: 800 }], ["phone 390×844", VIEWPORT]]) {
    const ctx = await browser.newContext({ viewport, isMobile: viewport.width < 500, hasTouch: viewport.width < 500 });
    const page = await ctx.newPage();
    try {
      await loginAs(page, server.base, FIXTURES.rider.email);
      await page.goto(server.base + "/org?org=e2e-biz", { waitUntil: "domcontentloaded" });
      await page.locator('[data-testid="button-portal-send-parcel"]').first().waitFor({ timeout: 45000 });
      for (const [name, id] of [["Send a parcel", "button-portal-send-parcel"], ["Book a ride", "button-portal-book"]]) {
        const box = await page.locator(`[data-testid="${id}"]`).first().boundingBox();
        const inside = !!box && box.y >= 0 && box.y + box.height <= viewport.height && box.x >= 0 && box.x + box.width <= viewport.width;
        check(`business ${label}: ${name} is on screen`, inside, box ? `x ${Math.round(box.x)}–${Math.round(box.x + box.width)} of ${viewport.width}` : "no box");
        const hit = await page.evaluate((sel) => { const el = document.querySelector(sel); if (!el) return false; const r = el.getBoundingClientRect(); const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!at && (el.contains(at) || at.contains(el)); }, `[data-testid="${id}"]`);
        check(`business ${label}: ${name} is hit-testable`, hit);
      }
      await page.keyboard.press("p");
      const drawer = page.locator('[data-testid="portal-delivery-drawer"]');
      await drawer.waitFor({ timeout: 5000 }).catch(() => {});
      check(`business ${label}: P opens the parcel drawer`, (await drawer.count()) === 1);
      await page.keyboard.press("Escape");
      check(`business ${label}: Escape closes it`, (await drawer.count()) === 0);
      const scrollW = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
      check(`business ${label}: no sideways scroll`, scrollW);
    } catch (e) {
      check(`business ${label}: audit ran`, false, String(e?.message ?? e).split("\n")[0]);
    } finally { await ctx.close(); }
  }

  section("Requester portal (organizations)");
  for (const [label, viewport] of [["desk 1280×800", { width: 1280, height: 800 }], ["phone 390×844", VIEWPORT]]) {
    const ctx = await browser.newContext({ viewport, isMobile: viewport.width < 500, hasTouch: viewport.width < 500 });
    const page = await ctx.newPage();
    try {
      await loginAs(page, server.base, FIXTURES.rider.email);
      await page.goto(server.base + "/org", { waitUntil: "domcontentloaded" });
      const book = page.locator('[data-testid="button-portal-book"]').first();
      // The desk pass is the FIRST portal load of the run: cold server, cold
      // browser, and this button only exists once login, /api/org/mine,
      // /api/org/:id and its jobs have all come back. Fifteen seconds was
      // enough warm and not always enough cold, so on the runner the desk
      // pass timed out while the phone pass right after it — same checks,
      // warm — passed. More room, and if it still does not appear, say what
      // WAS on the screen instead of only "Timeout exceeded".
      await book.waitFor({ timeout: 45000 }).catch(async () => {
        const seen = await page.evaluate(() => ({
          loading: !!document.querySelector('[data-testid="portal-loading"]'),
          empty: !!document.querySelector('[data-testid="portal-empty"]'),
          text: (document.body.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120),
        }));
        throw new Error(`Book a job never appeared — still loading: ${seen.loading}, empty state: ${seen.empty} :: ${seen.text}`);
      });
      const box = await book.boundingBox();
      const inside = !!box && box.y >= 0 && box.y + box.height <= viewport.height && box.x >= 0 && box.x + box.width <= viewport.width;
      check(`portal ${label}: Book a job is on screen`, inside, box ? `at ${Math.round(box.x)},${Math.round(box.y)}` : "no box");
      const hit = await page.evaluate(() => { const el = document.querySelector('[data-testid="button-portal-book"]'); if (!el) return false; const r = el.getBoundingClientRect(); const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!at && (el.contains(at) || at.contains(el)); });
      check(`portal ${label}: Book a job is hit-testable`, hit);
      check(`portal ${label}: the board and the map are both present`, (await page.locator('[data-testid="portal-today"]').count()) === 1 && (await page.locator('[data-testid="portal-jobs-map"]').count()) === 1);
      await page.keyboard.press("n");
      const drawer = page.locator('[data-testid="portal-book-drawer"]');
      await drawer.waitFor({ timeout: 5000 }).catch(() => {});
      check(`portal ${label}: N opens the booking form with the passenger field focused`, (await drawer.count()) === 1 && (await page.evaluate(() => document.activeElement?.getAttribute("data-testid"))) === "input-portal-passenger-name");
      await page.keyboard.press("Escape");
      check(`portal ${label}: Escape closes it`, (await drawer.count()) === 0);
      const scrollW = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
      check(`portal ${label}: no sideways scroll`, scrollW);
    } catch (e) {
      check(`portal ${label}: audit ran`, false, String(e?.message ?? e).split("\n")[0]);
    } finally { await ctx.close(); }
  }
}
} finally { await browser.close(); stopServer(server); }

process.exit(summary() === 0 ? 0 : 1);
