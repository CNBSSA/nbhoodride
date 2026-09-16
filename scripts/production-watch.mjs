#!/usr/bin/env node
/**
 * Production watch — the outside half of proactive reliability.
 *
 * Runs from .github/workflows/production-watch.yml every ten minutes and
 * answers one question: can a rider use PG Ride right now? It needs no
 * dependencies and no secrets, so it can run anywhere:
 *
 *   node scripts/production-watch.mjs
 *   BASE_URL=https://pgride.com node scripts/production-watch.mjs
 *
 * Probes, in the order a rider meets them:
 *   /health            the process answers
 *   /api/version       the deployed build is identified
 *   /                  the front page is served to a signed-out visitor
 *   /?probe=1          the React app shell riders load
 *   /terms             a server-rendered page carries its text
 *   /health/deps       the server's own view of database and Stripe
 *
 * Exit 0 when everything answers; exit 1 with a one-line summary on stdout
 * (the workflow puts it in the Telegram page) otherwise. The in-server
 * dependency watch already pages when Stripe or the database fails, so a
 * /health/deps 503 is reported here as context, not as a second page.
 */

const baseUrl = (process.env.BASE_URL || "https://nbhoodride-production.up.railway.app").replace(/\/+$/, "");
const TIMEOUT_MS = 15_000;

const failures = [];
const notes = [];

async function get(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const res = await fetch(baseUrl + path, { redirect: "follow", headers: { Accept: "text/html,application/json,*/*" }, signal: controller.signal });
    const body = await res.text();
    return { status: res.status, body, ms: Date.now() - t0 };
  } catch (err) {
    return { status: 0, body: "", ms: Date.now() - t0, error: err?.name === "AbortError" ? `no answer within ${TIMEOUT_MS / 1000}s` : String(err?.message ?? err) };
  } finally {
    clearTimeout(timer);
  }
}

async function probe(name, path, { expectStatus = 200, expectText = [], json = false } = {}) {
  const r = await get(path);
  if (r.status !== expectStatus) {
    failures.push(`${name} (${path}): ${r.status === 0 ? r.error : `HTTP ${r.status}`}`);
    return null;
  }
  for (const t of expectText) {
    if (!r.body.includes(t)) failures.push(`${name} (${path}): answered but without "${t}"`);
  }
  if (r.ms > 5_000) notes.push(`${name} slow: ${r.ms} ms`);
  if (json) { try { return JSON.parse(r.body); } catch { failures.push(`${name} (${path}): not JSON`); return null; } }
  return r.body;
}

const health = await probe("Process", "/health");
const version = await probe("Build", "/api/version", { json: true });
// A signed-out visitor at "/" gets the server-rendered front page; the
// React app shell is what every rider actually loads (any URL with a query
// string, or any URL once signed in).
await probe("Front page", "/", { expectText: ["PG Ride"] });
await probe("App shell", "/?probe=1", { expectText: ['id="root"'] });
await probe("Terms page", "/terms", { expectText: ["Terms of Service"] });

// The server's own lifelines. A 503 here means the in-server watch has
// already paged; we add it to the summary so the page reads whole.
// `probe` marks this run in the server's heartbeat log, so the 4 AM review
// can say whether the outside watch actually ran overnight.
const deps = await get("/health/deps?probe=production-watch");
let depsDown = [];
try {
  const d = JSON.parse(deps.body || "{}");
  depsDown = Array.isArray(d.down) ? d.down : [];
  // Carry the REASON, not just the name. "server reports down: maps" tells
  // the operator something is wrong and nothing about what to do; the
  // dependency's own detail says whether a token is absent, rejected,
  // rate-limited or the provider is unreachable — four different fixes.
  // These details are written to be safe to show: /health/deps is public and
  // the watch redacts keys before they ever reach it.
  const withWhy = depsDown
    .map((n) => {
      const why = d.deps?.[n]?.detail;
      return why ? `${n} — ${String(why).slice(0, 160)}` : n;
    })
    .join("; ");
  // The database down is not a degraded server, it is no server a rider can
  // use — /health still answers 200 because it is a flat OK. So it is a
  // FAILURE here, not a note, and this watch goes red (daily audit, #384).
  // The other dependencies degrade a feature and stay notes: the server
  // has already paged them itself.
  if (depsDown.includes("database")) failures.push(`Database down: ${d.deps?.database?.detail ?? "unreachable from the server"}`);
  if (deps.status === 503 || depsDown.length > 0) notes.push(`server reports down: ${withWhy || "unknown"} [already paged by the server]`);
  else if (deps.status !== 200) failures.push(`Dependencies (/health/deps): HTTP ${deps.status}`);
} catch {
  if (health) failures.push(`Dependencies (/health/deps): ${deps.status === 0 ? deps.error : `HTTP ${deps.status}, not JSON`}`);
}

// /api/version answers { id, builtAt } (scripts/write-build-id.mjs): the id is the commit on Railway.
const sha = version && typeof version === "object" ? String(version.id ?? version.sha ?? version.buildId ?? version.commit ?? "").slice(0, 7) : "";
const summary = failures.length === 0
  ? `OK — PG Ride is up${sha ? ` on ${sha}` : ""}${notes.length ? ` (${notes.join("; ")})` : ""}`
  : `DOWN — ${failures.join(" · ")}${notes.length ? ` (${notes.join("; ")})` : ""}`;

console.log(JSON.stringify({ ok: failures.length === 0, baseUrl, sha, failures, notes, checkedAt: new Date().toISOString() }));
console.log(summary);
process.exit(failures.length === 0 ? 0 : 1);
