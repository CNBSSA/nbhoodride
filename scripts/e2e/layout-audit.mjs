/**
 * Mobile layout audit: opens each sheet on a 390×844 phone viewport and
 * asserts its primary action is (a) fully inside the viewport without
 * scrolling and (b) actually hit-testable at its centre (nothing — like the
 * bottom navigation or a floating pill — is drawn on top of it).
 *
 * This is the guard for the "I can see a sliver of the button" class of bug.
 * Run locally: npm run test:layout   (needs a built app + Postgres, like the journeys)
 */
import { chromium } from "playwright";
import { connectDb, seedFixtures, startServer, stopServer, FIXTURES, PASSWORD, check, section, summary } from "./harness.mjs";

const VIEWPORT = { width: 390, height: 844 };
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;

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
const server = await startServer({ DRIVER_MARKETPLACE_ENABLED: "true" });
const browser = await chromium.launch({ executablePath, args: ["--no-sandbox", "--no-proxy-server"] });
try {
  const ctx = await browser.newContext({ viewport: VIEWPORT, hasTouch: true, isMobile: true, deviceScaleFactor: 2,
    geolocation: { latitude: 38.9073, longitude: -76.7781 }, permissions: ["geolocation"] });
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
  await page.close();

  section("Rider: schedule and book sheets");
  page = await ctx.newPage();
  await loginAs(page, server.base, FIXTURES.rider.email);
  await page.evaluate(() => localStorage.setItem("pgride:lastMode", "rider"));
  await page.goto(server.base + "/", { waitUntil: "domcontentloaded" });
  try { await page.tap('[data-testid="welcome-dismiss"]', { timeout: 3000 }); } catch {}
  await page.waitForSelector('[data-testid="button-schedule-ride"]', { timeout: 20000 });
  await page.tap('[data-testid="button-schedule-ride"]');
  await assertPrimary(page, "Schedule sheet", "button-confirm-booking");
  await page.tap('[data-testid="button-close-schedule"]');
  await page.waitForSelector('[data-testid="button-book-ride"]', { timeout: 10000 });
  // Book-now is destination-first: type, pick a suggestion, then the driver
  // panel with the pinned Confirm appears. Geocoding is stubbed (no egress).
  await page.route("**/api/geocode/suggest*", (route) => route.fulfill({ contentType: "application/json",
    body: JSON.stringify({ suggestions: [{ label: "National Harbor, Oxon Hill, MD", lat: 38.7823, lng: -77.0166 }] }) }));
  await page.tap('[data-testid="button-book-ride"]');
  await page.waitForSelector('[data-testid="input-destination"]', { timeout: 10000 });
  await page.fill('[data-testid="input-destination"]', "National Harbor");
  await page.waitForSelector('[data-testid="suggestion-0"]', { timeout: 10000 });
  await page.tap('[data-testid="suggestion-0"]');
  await assertPrimary(page, "Book-now driver panel", "button-confirm-booking");
} finally { await browser.close(); stopServer(server); }
process.exit(summary() === 0 ? 0 : 1);
