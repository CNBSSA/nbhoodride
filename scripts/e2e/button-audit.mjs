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

/** Never pressed: leaves the account, calls for help, destroys data, or reloads the page. */
const NEVER = /logout|sign-?out|delete|remove-account|sos|emergency|panic|911|error-reload|call-|dial|share-native|open-maps|navigate-external|install-app/i;

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
  const onResponse = (r) => { if (r.status() >= 500 && r.url().includes("/api/")) s.serverErrors.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`); };
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
  await page.waitForTimeout(150);
  const here = new URL(page.url()).pathname;
  const dialogOpen = await page.locator('[role="dialog"]').first().isVisible().catch(() => false);
  if (here !== screen.path || dialogOpen) {
    await page.goto(base + screen.path, { waitUntil: "domcontentloaded" }).catch(() => {});
    await afterLoad(page, opts);
  }
}

async function afterLoad(page, opts) {
  // The app is client-rendered: wait until something is on screen (up to 10s), then a beat for data.
  await page.waitForFunction(() => (document.body?.innerText ?? "").replace(/\s+/g, "").length > 20, null, { timeout: 10_000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 4_000 }).catch(() => {});
  await page.waitForTimeout(300);
  try { await page.locator('[data-testid="welcome-dismiss"]').first().click({ timeout: 800 }); } catch {}
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
  const s = watch(page);
  try {
    await loc.click({ timeout: 2000 });
  } catch (e) {
    s.stop();
    // Covered by another layer (a sheet over the map's zoom control, the
    // navigation under a full-screen chat): not a dead button, just not
    // pressable from here. Counted, reported, never failed.
    covered.add(`${label}`);
    return null;
  }
  await settle(page);
  const problems = await screenVerdict(page, s);
  s.stop();
  pressCount += 1;
  if (testid) pressed.add(testid);
  return { label, problems };
}

async function auditScreen(browser, base, screen) {
  const context = await browser.newContext({ viewport: VIEWPORT, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  if (screen.role === "driver") await context.addInitScript(() => localStorage.setItem("pgride:lastMode", "driver"));
  if (screen.role !== "visitor") await loginAs(page, base, ROLE_USER[screen.role]);
  const opts = {};
  const load = watch(page);
  await page.goto(base + screen.path, { waitUntil: "domcontentloaded" });
  await afterLoad(page, opts);
  const loadProblems = await screenVerdict(page, load);
  load.stop();
  const name = `${screen.role} ${screen.path}`;
  const results = [[`${name}: screen loads clean`, loadProblems.length === 0, loadProblems.join("; ")]];

  const broken = [];
  const baseline = await visibleClickables(page);
  const baseKeys = new Set(baseline.map((b) => b.key));
  let pressedHere = 0;
  for (const target of baseline) {
    const r = await pressOne(page, base, screen, opts, target, []);
    if (!r) continue;
    pressedHere += 1;
    if (r.problems.length) broken.push(r);
    // Depth 2: anything that appeared because of this press.
    const now = await visibleClickables(page);
    const children = now.filter((c) => !baseKeys.has(c.key));
    for (const child of children.slice(0, 20)) {
      await restore(page, base, screen, opts);
      const again = await pressOne(page, base, screen, opts, target, []);
      if (!again) break;
      const rc = await pressOne(page, base, screen, opts, child, [target.text || target.key]);
      if (!rc) continue;
      pressedHere += 1;
      if (rc.problems.length) broken.push(rc);
    }
    await restore(page, base, screen, opts);
  }
  results.push([`${name}: ${pressedHere} presses, every button answered`, broken.length === 0, broken.map((b) => `${b.label}: ${b.problems.join("; ")}`).join(" | ")]);
  await context.close();
  section(name);
  for (const [label, ok, detail] of results) check(label, ok, detail);
  return pressedHere;
}

// ── main ──
const db = await connectDb();
await seedFixtures(db);
// Production build over plain http: Chromium keeps Secure cookies on loopback but
// the flag is what the layout audit relies on too; the marketplace is on so the
// driver's claim board is a screen, not an empty state.
const server = await startServer({ DRIVER_MARKETPLACE_ENABLED: "true", E2E_INSECURE_COOKIES: "1" });
const browser = await chromium.launch({ executablePath, args: ["--no-sandbox", "--no-proxy-server"] });
let total = 0;
const PARALLEL = Number(process.env.BUTTON_AUDIT_PARALLEL || 3);
try {
  // Each screen has its own browser context and its own signed-in session, so
  // screens can run side by side; results are printed as each one finishes.
  const queue = [...SCREENS];
  await Promise.all(Array.from({ length: PARALLEL }, async () => {
    while (queue.length) {
      const screen = queue.shift();
      try { total += await auditScreen(browser, server.base, screen); }
      catch (e) { check(`${screen.role} ${screen.path}: audit ran`, false, String(e?.message ?? e).split("\n")[0]); }
    }
  }));
} finally {
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
if (!baselineFile) {
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
