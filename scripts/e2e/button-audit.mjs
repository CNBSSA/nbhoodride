/**
 * Every-button audit: "all features, menus and buttons work without issues".
 *
 * Signs in as a rider, a driver and an admin (and once signed out), opens
 * every screen, presses every button that is safe to press — and every
 * button that appears inside whatever that opened — and fails if any press
 * produces a crash (error boundary), an uncaught JavaScript error, a blank
 * screen, a red error toast, or a 5xx from the server.
 *
 * It does not check that a button did the right thing; the journeys do that
 * for the flows that move money. It checks that nothing is dead.
 *
 * Coverage rule: every `data-testid="button-…"` in client/src must be
 * pressed by this audit or listed in button-audit-baseline.json with a
 * reason. A new button that the audit cannot reach fails the run, so no
 * button ships untested.
 *
 * Run locally: npm run test:buttons   (needs a built app + Postgres, like the journeys)
 */
import { chromium } from "playwright";
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { connectDb, seedFixtures, startServer, stopServer, FIXTURES, PASSWORD, check, section, summary } from "./harness.mjs";

const VIEWPORT = { width: 390, height: 844 };
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;
const SETTLE_MS = 450;
const ROOT = new URL("../../", import.meta.url).pathname;
const BASELINE_PATH = join(ROOT, "scripts/e2e/button-audit-baseline.json");

/**
 * Never pressed: leaves the account, calls for help, destroys data, reloads
 * the page, or (as admin) changes another person's standing — the audit once
 * suspended the fixture driver from the admin screen and the next journey
 * could not go online.
 */
const NEVER = /logout|sign-?out|delete|remove-account|sos|emergency|panic|911|error-reload|call-|dial|share-native|open-maps|navigate-external|install-app|suspend|unsuspend|ban|reject|revoke|deactivate|disable|refund|payout|reset-password|force-/i;

/** What a rider can tap. Order matters: testid keys are stable, text keys are the fallback. */
const CLICKABLE = [
  '[data-testid^="button-"]', '[data-testid^="tab-"]', '[data-testid^="nav-"]', '[data-testid^="link-"]',
  '[data-testid^="toggle-"]', '[data-testid^="switch-"]', '[data-testid^="chip-"]', '[data-testid^="card-"][role="button"]',
  'button', '[role="button"]', '[role="tab"]', '[role="menuitem"]', 'a[href^="/"]',
].join(", ");

const SCREENS = [
  { role: "visitor", path: "/" }, { role: "visitor", path: "/login" }, { role: "visitor", path: "/signup" },
  { role: "visitor", path: "/forgot-password" }, { role: "visitor", path: "/terms" }, { role: "visitor", path: "/privacy" },
  { role: "rider", path: "/" }, { role: "rider", path: "/ratings" }, { role: "rider", path: "/payments" }, { role: "rider", path: "/card-setup" },
  { role: "driver", path: "/" }, { role: "driver", path: "/driver/insights" },
  { role: "admin", path: "/admin" }, { role: "admin", path: "/" },
];

/** BUTTON_AUDIT_ONLY="rider /" runs one screen; BUTTON_AUDIT_VERBOSE=1 prints every press. */
const ONLY = process.env.BUTTON_AUDIT_ONLY || "";
const VERBOSE = process.env.BUTTON_AUDIT_VERBOSE === "1";
const ROLE_USER = { rider: FIXTURES.rider.email, driver: FIXTURES.driver.email, admin: FIXTURES.admin.email };

// ── source inventory: every static button testid, and every templated prefix ──
function sourceFiles(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.(tsx|ts)$/.test(f)) out.push(p);
  }
  return out;
}
const src = sourceFiles(join(ROOT, "client/src")).map((p) => readFileSync(p, "utf8")).join("\n");
const staticIds = new Set([...src.matchAll(/data-testid=\{?"(button-[^"]+)"/g)].map((m) => m[1]));
const templatePrefixes = new Set([...src.matchAll(/data-testid=\{`(button-[^`$]+)\$\{/g)].map((m) => m[1]));

// ── browser plumbing ──
async function loginAs(page, base, email) {
  await page.goto(base + "/login", { waitUntil: "domcontentloaded" });
  const status = await page.evaluate(async ({ email, password }) => {
    await fetch("/api/csrf", { credentials: "include" });
    const t = document.cookie.split("; ").find((c) => c.startsWith("csrf_token="))?.split("=")[1] ?? "";
    return (await fetch("/api/auth/email-login", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": decodeURIComponent(t) }, body: JSON.stringify({ email, password }), credentials: "include" })).status;
  }, { email, password: PASSWORD });
  if (status !== 200) throw new Error(`login as ${email} failed: ${status}`);
}

/** Everything tappable and visible right now, keyed so the same control has the same key every time. */
async function visibleClickables(page) {
  return page.evaluate((selector) => {
    const seen = new Map();
    const els = Array.from(document.querySelectorAll(selector));
    for (const el of els) {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (r.width < 4 || r.height < 4 || style.visibility === "hidden" || style.display === "none" || style.pointerEvents === "none") continue;
      if (el.disabled || el.getAttribute("aria-disabled") === "true") continue;
      const testid = el.getAttribute("data-testid");
      const text = (el.getAttribute("aria-label") || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40);
      const href = el.getAttribute("href");
      const key = testid ? `testid:${testid}` : href ? `href:${href}` : text ? `text:${el.tagName.toLowerCase()}:${text}` : null;
      if (!key || seen.has(key)) continue;
      seen.set(key, { key, testid, text, tag: el.tagName.toLowerCase(), inDialog: !!el.closest('[role="dialog"], [data-state="open"][data-side], [data-vaul-drawer]') });
    }
    return Array.from(seen.values());
  }, CLICKABLE);
}

/** "notification-item-<uuid>" and "button-confirm-scheduled-<uuid>" are one button each, not fifty. */
function family(item) {
  const id = item.testid || item.key;
  return id.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "*").replace(/-\d+$/, "-*");
}
function oneOfEach(items) {
  const seen = new Set();
  return items.filter((it) => { const f = family(it); if (seen.has(f)) return false; seen.add(f); return true; });
}

function locatorFor(page, key) {
  if (key.startsWith("testid:")) return page.locator(`[data-testid="${key.slice(7)}"]`).first();
  if (key.startsWith("href:")) return page.locator(`a[href="${key.slice(5)}"]`).first();
  const [, tag, text] = key.split(":");
  return page.locator(tag, { hasText: text }).first();
}

/** Signals collected between two points in time. */
function watch(page) {
  const s = { pageErrors: [], consoleErrors: [], serverErrors: [] };
  const onPageError = (e) => s.pageErrors.push(String(e?.message ?? e).slice(0, 200));
  const onConsole = (m) => { if (m.type() === "error") { const t = m.text(); if (!/favicon|manifest|sw\.js|service worker|401|403|404|Failed to load resource/i.test(t)) s.consoleErrors.push(t.slice(0, 200)); } };
  // 503 is the server saying "a dependency is down" in plain words (Stripe is
  // unreachable wherever this audit runs); that is an outage answer, not a
  // dead button. 500/502/504 are.
  const onResponse = (r) => { if (r.status() >= 500 && r.status() !== 503 && r.url().includes("/api/")) s.serverErrors.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`); };
  page.on("pageerror", onPageError); page.on("console", onConsole); page.on("response", onResponse);
  s.stop = () => { page.off("pageerror", onPageError); page.off("console", onConsole); page.off("response", onResponse); };
  return s;
}

async function screenVerdict(page, s) {
  const dom = await page.evaluate(() => ({
    crashed: !!document.querySelector('[data-testid="button-error-reload"]'),
    blank: (document.body?.innerText ?? "").replace(/\s+/g, "").length < 20,
    redToast: Array.from(document.querySelectorAll('[role="status"].destructive, [role="status"][class*="destructive"], li[class*="destructive"][role="status"]'))
      .map((t) => t.textContent.replace(/\s+/g, " ").trim().slice(0, 120)).filter(Boolean),
  })).catch(() => ({ crashed: false, blank: true, redToast: [] }));
  const problems = [];
  if (dom.crashed) problems.push("error screen");
  if (dom.blank) problems.push("blank screen");
  for (const t of dom.redToast) problems.push(`red toast: ${t}`);
  for (const e of s.pageErrors) problems.push(`uncaught: ${e}`);
  for (const e of s.serverErrors) problems.push(`server ${e}`);
  for (const e of s.consoleErrors) if (/React|Uncaught|TypeError|ReferenceError|Cannot read|is not a function/.test(e)) problems.push(`console: ${e}`);
  return problems;
}

async function settle(page) { await page.waitForTimeout(SETTLE_MS); }

async function restore(page, base, screen, opts) {
  // Close whatever opened, then make sure we are back on the screen.
  for (let i = 0; i < 2; i++) { await page.keyboard.press("Escape").catch(() => {}); }
  // A drawer takes ~300 ms to slide away; its overlay would fail the next hit-test.
  await page.waitForTimeout(450);
  const here = new URL(page.url()).pathname;
  const dialogOpen = await page.locator('[role="dialog"]').first().isVisible().catch(() => false);
  if (here !== screen.path || dialogOpen) {
    await page.goto(base + screen.path, { waitUntil: "domcontentloaded" }).catch(() => {});
    await afterLoad(page, opts);
  }
}

async function dismissGreetings(page) {
  for (const sel of ['[data-testid="welcome-dismiss"]', '[data-testid="button-dismiss-push"]', '[data-testid="button-close-push-prompt"]', '[data-testid="button-ios-hint-done"]', '[data-testid="button-close-ios-hint"]', '[data-testid="install-gate-dev-skip"]']) {
    try { await page.locator(sel).first().click({ timeout: 300 }); } catch {}
  }
}

async function afterLoad(page, opts) {
  // The app is client-rendered: wait until something is on screen (up to 10s), then a beat for data.
  await page.waitForFunction(() => (document.body?.innerText ?? "").replace(/\s+/g, "").length > 20, null, { timeout: 10_000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 4_000 }).catch(() => {});
  await page.waitForTimeout(300);
  // Sheets that greet a returning user sit over the navigation; put them away
  // first (they are pressed on their own when the audit meets them).
  await dismissGreetings(page);
  if (opts?.tab) { try { await page.locator(`[data-testid="${opts.tab}"]`).first().click({ timeout: 800 }); await page.waitForTimeout(300); } catch {} }
}

const pressed = new Set();
const skipped = new Map();
const covered = new Set();
let pressCount = 0;

async function pressOne(page, base, screen, opts, target, path) {
  const label = [...path, target.text || target.key].join(" → ");
  const testid = target.testid;
  if (testid && NEVER.test(testid)) { skipped.set(testid, "never pressed (leaves the app, calls for help, or destroys data)"); return null; }
  if (!testid && NEVER.test(target.text)) { skipped.set(target.key, "never pressed"); return null; }
  const loc = locatorFor(page, target.key);
  if (!(await loc.isVisible().catch(() => false))) return null;
  const hit = await loc.evaluate((el) => {
    el.scrollIntoView({ block: "center", inline: "center" });
    const r = el.getBoundingClientRect();
    const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!at && (el.contains(at) || at.contains(el));
  }).catch(() => false);
  if (!hit) {
    // A greeting sheet (push prompt, install hint) can arrive after the screen
    // settled and sit over the navigation; put it away and look once more.
    await dismissGreetings(page);
    const again = await loc.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!at && (el.contains(at) || at.contains(el));
    }).catch(() => false);
    if (!again) { covered.add(label); return "covered"; }
  }
  const s = watch(page);
  try {
    await loc.click({ timeout: 4000 });
  } catch (e) {
    s.stop();
    // Covered by another layer (a sheet over the map's zoom control, the
    // navigation under a full-screen chat): not a dead button, just not
    // pressable from here. Counted, reported, never failed.
    covered.add(`${label}`);
    return "covered";
  }
  await settle(page);
  const problems = await screenVerdict(page, s);
  s.stop();
  pressCount += 1;
  if (VERBOSE) console.log(`    · ${label}${problems.length ? ` ⚠ ${problems.join("; ")}` : ""}`);
  if (testid) pressed.add(testid);
  return { label, problems };
}

const contexts = new Map();
/** One signed-in context per role, shared by its screens: three logins per run, not one per screen. */
async function contextFor(browser, base, role) {
  if (contexts.has(role)) return contexts.get(role);
  const context = await browser.newContext({ viewport: VIEWPORT, isMobile: true, hasTouch: true });
  if (role === "driver") await context.addInitScript(() => localStorage.setItem("pgride:lastMode", "driver"));
  const page = await context.newPage();
  if (role !== "visitor") await loginAs(page, base, ROLE_USER[role]);
  contexts.set(role, { context, page });
  return contexts.get(role);
}

async function auditScreen(browser, base, screen) {
  const { page } = await contextFor(browser, base, screen.role);
  const opts = {};
  const load = watch(page);
  await page.goto(base + screen.path, { waitUntil: "domcontentloaded" });
  await afterLoad(page, opts);
  const loadProblems = await screenVerdict(page, load);
  load.stop();
  const name = `${screen.role} ${screen.path}`;
  const results = [[`${name}: screen loads clean`, loadProblems.length === 0, loadProblems.join("; ")]];

  const broken = [];
  const baseline = oneOfEach(await visibleClickables(page));
  if (VERBOSE) console.log(`  ${name}: ${baseline.length} on screen: ${baseline.map((b) => b.testid || b.text || b.key).join(" | ")}`);
  const baseKeys = new Set(baseline.map((b) => b.key));
  let pressedHere = 0;
  for (const target of baseline) {
    // A base press can change the whole screen (a mode switch, a tab). If
    // the next target is no longer there, reload the screen and look again.
    if (!(await locatorFor(page, target.key).isVisible().catch(() => false))) {
      await page.goto(base + screen.path, { waitUntil: "domcontentloaded" }).catch(() => {});
      await afterLoad(page, opts);
    }
    let r = await pressOne(page, base, screen, opts, target, []);
    if (r === "covered") {
      // Something is still drawn over the screen (a sheet that ignores
      // Escape). Reload the screen and try this one once more.
      await page.goto(base + screen.path, { waitUntil: "domcontentloaded" }).catch(() => {});
      await afterLoad(page, opts);
      covered.delete([target.text || target.key].join(" → "));
      r = await pressOne(page, base, screen, opts, target, []);
    }
    if (!r || r === "covered") continue;
    pressedHere += 1;
    if (r.problems.length) broken.push(r);
    // Depth 2: anything that appeared because of this press. A sheet takes a
    // moment to fill, so give it one before looking.
    if (await page.locator('[role="dialog"]').first().isVisible().catch(() => false)) await page.waitForTimeout(500);
    const now = await visibleClickables(page);
    // Named buttons first: they are the ones the coverage rule tracks, and a
    // sheet's day chips or list rows would otherwise crowd them out of the cap.
    const children = oneOfEach(now.filter((c) => !baseKeys.has(c.key))).sort((a, b) => (b.testid ? 1 : 0) - (a.testid ? 1 : 0));
    if (VERBOSE && children.length) console.log(`      opened ${children.length}: ${children.slice(0, 30).map((c) => c.testid || c.text || c.key).join(" | ")}`);
    let open = true;
    for (const child of children.slice(0, 30)) {
      // Most presses inside a sheet leave it open (a chip, a toggle, a tab);
      // only reopen it when the last press closed it or navigated away.
      const stillHere = open && new URL(page.url()).pathname === screen.path && (await locatorFor(page, child.key).isVisible().catch(() => false));
      if (!stillHere) {
        await restore(page, base, screen, opts);
        const again = await pressOne(page, base, screen, opts, target, []);
        if (!again || again === "covered") break;
      }
      const rc = await pressOne(page, base, screen, opts, child, [target.text || target.key]);
      open = !!rc && rc !== "covered";
      if (!rc || rc === "covered") continue;
      pressedHere += 1;
      if (rc.problems.length) broken.push(rc);
    }
    await restore(page, base, screen, opts);
  }
  results.push([`${name}: ${pressedHere} presses, every button answered`, broken.length === 0, broken.map((b) => `${b.label}: ${b.problems.join("; ")}`).join(" | ")]);
  section(name);
  for (const [label, ok, detail] of results) check(label, ok, detail);
  return pressedHere;
}

// ── main ──
const db = await connectDb();
await seedFixtures(db);
// The rider home changes with history: "Book again", the receipt and the
// re-book confirm only exist once the rider has completed a ride. Seed one so
// the audit sees the same screens on a fresh CI database as on a used one.
{
  const { rows } = await db.query("SELECT 1 FROM rides WHERE rider_id=$1 AND status='completed' LIMIT 1", [FIXTURES.rider.id]);
  if (rows.length === 0) {
    await db.query(
      `INSERT INTO rides (rider_id, driver_id, status, pickup_location, destination_location, estimated_fare, actual_fare, payment_method, created_at, completed_at)
       VALUES ($1, $2, 'completed', $3, $4, 23.21, 23.21, 'card', NOW() - interval '2 days', NOW() - interval '2 days' + interval '25 minutes')`,
      [FIXTURES.rider.id, FIXTURES.driver.id, JSON.stringify({ lat: 38.9073, lng: -76.7781, address: "Bowie, MD" }), JSON.stringify({ lat: 38.7823, lng: -77.0166, address: "National Harbor, MD" })]);
  }
}
// Production build over plain http: Chromium keeps Secure cookies on loopback but
// the flag is what the layout audit relies on too; the marketplace is on so the
// driver's claim board is a screen, not an empty state.
const server = await startServer({ DRIVER_MARKETPLACE_ENABLED: "true", E2E_INSECURE_COOKIES: "1", GENERAL_RATE_LIMIT_MAX: "1000000" });
const browser = await chromium.launch({ executablePath, args: ["--no-sandbox", "--no-proxy-server"] });
let total = 0;
const PARALLEL = Number(process.env.BUTTON_AUDIT_PARALLEL || 1);
try {
  // Each screen has its own browser context and its own signed-in session, so
  // screens can run side by side; results are printed as each one finishes.
  const queue = SCREENS.filter((sc) => !ONLY || `${sc.role} ${sc.path}` === ONLY);
  await Promise.all(Array.from({ length: PARALLEL }, async () => {
    while (queue.length) {
      const screen = queue.shift();
      try { total += await auditScreen(browser, server.base, screen); }
      catch (e) { check(`${screen.role} ${screen.path}: audit ran`, false, String(e?.message ?? e).split("\n")[0]); }
    }
  }));
} finally {
  for (const { context } of contexts.values()) await context.close().catch(() => {});
  await browser.close();
  stopServer(server);
  await db.end();
}

section("Coverage");
const isPressed = (id) => pressed.has(id);
const templateCovered = (prefix) => [...pressed].some((p) => p.startsWith(prefix));
const unpressedStatic = [...staticIds].filter((id) => !isPressed(id) && !NEVER.test(id)).sort();
const unpressedTemplates = [...templatePrefixes].filter((p) => !templateCovered(p) && !NEVER.test(p)).sort();
const neverPressed = [...staticIds].filter((id) => NEVER.test(id)).length;
const baselineFile = existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, "utf8")) : null;
if (covered.size) console.log(`  not pressable from where the audit stood (covered by another layer), ${covered.size}: ${[...covered].slice(0, 12).join(", ")}${covered.size > 12 ? ", …" : ""}`);
if (skipped.size) console.log(`  never pressed by rule, ${skipped.size}: ${[...skipped.keys()].join(", ")}`);
console.log(`  buttons in source: ${staticIds.size} static + ${templatePrefixes.size} templated · pressed ${pressed.size} distinct testids in ${pressCount} presses across ${SCREENS.length} screens · ${neverPressed} never pressed by rule`);
if (ONLY) {
  console.log("  (single-screen run: coverage not judged)");
} else if (!baselineFile) {
  writeFileSync(BASELINE_PATH, JSON.stringify({
    note: "Buttons the every-button audit cannot reach today. Each entry is a debt: reach it or remove it. A button not listed here and not pressed fails the audit.",
    unreachable: Object.fromEntries([...unpressedStatic, ...unpressedTemplates.map((p) => `${p}*`)].map((id) => [id, "not reachable from the audited screens yet"])),
  }, null, 2) + "\n");
  check("baseline written (first run) — commit scripts/e2e/button-audit-baseline.json", true, `${unpressedStatic.length + unpressedTemplates.length} listed`);
} else {
  const known = new Set(Object.keys(baselineFile.unreachable ?? {}));
  const newUnreached = [...unpressedStatic.filter((id) => !known.has(id)), ...unpressedTemplates.filter((p) => !known.has(`${p}*`)).map((p) => `${p}*`)];
  check(`every button in source is pressed by the audit or listed in the baseline`, newUnreached.length === 0, newUnreached.length ? `new buttons the audit cannot reach: ${newUnreached.join(", ")} — give them a path in button-audit.mjs or list them in button-audit-baseline.json with a reason` : "");
  const nowReachable = [...known].filter((id) => id.endsWith("*") ? templateCovered(id.slice(0, -1)) : isPressed(id));
  if (nowReachable.length) console.log(`  ✨ now reachable, remove from baseline: ${nowReachable.join(", ")}`);
}
process.exit(summary() === 0 ? 0 : 1);
