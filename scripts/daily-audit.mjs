#!/usr/bin/env node
/**
 * PG Ride daily audit — Phase 1 automated gates.
 * Full playbook: docs/DAILY_AUDIT_PROMPT.md
 *
 * Usage:
 *   npm run audit:daily
 *   BASE_URL=https://peoplegoverned.com npm run audit:daily
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const baseUrl = (process.env.BASE_URL || "https://nbhoodride-production.up.railway.app").replace(
  /\/+$/,
  "",
);

const failures = [];
const warnings = [];

function run(name, cmd, args, opts = {}) {
  console.log(`\n▶ ${name}`);
  const result = spawnSync(cmd, args, { cwd: root, stdio: "inherit", shell: false, ...opts });
  if (result.status !== 0) failures.push(name);
  return result.status === 0;
}

async function fetchJson(path) {
  const res = await fetch(`${baseUrl}${path}`, { redirect: "follow" });
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    warnings.push(`${path} returned non-JSON (HTTP ${res.status}) — deploy may be behind`);
    return null;
  }
  return res.json();
}

console.log(`PG Ride daily audit — ${new Date().toISOString().slice(0, 10)}`);
console.log(`BASE_URL=${baseUrl}`);
console.log("Audit branch: develop (integration). Production: main after promote — see docs/GIT_WORKFLOW.md");

spawnSync("git", ["fetch", "origin", "develop", "main"], { cwd: root, stdio: "ignore" });
const parity = spawnSync(
  "git",
  ["rev-list", "--left-right", "--count", "origin/develop...origin/main"],
  { cwd: root, encoding: "utf8" },
);
if (parity.status === 0 && parity.stdout?.trim()) {
  const [developOnly, mainOnly] = parity.stdout.trim().split(/\s+/).map(Number);
  console.log(
    `develop↔main: ${developOnly} commits on develop not in main, ${mainOnly} on main not in develop`,
  );
  if (developOnly > 0 || mainOnly > 0) {
    warnings.push(
      `branch skew: develop and main differ (${developOnly} develop-only, ${mainOnly} main-only)`,
    );
  }
} else {
  warnings.push("could not compute develop/main parity (git fetch origin develop main)");
}

run("npm run check", "npm", ["run", "check"]);
run("npm test", "npm", ["test"]);

// On a push to main the gate starts within seconds, but Railway takes a few
// minutes to build and deploy that commit. Probing production before the
// deploy lands judges the OLD build against the NEW expectations (which is
// how a green promotion produced a red gate on 2026-09-08). When the
// workflow tells us which commit should be live, wait for /api/version to
// report it — up to a bounded time — before the production probes.
const expectSha = (process.env.EXPECT_BUILD_SHA || "").trim().slice(0, 12);
if (expectSha) {
  console.log(`\n▶ waiting for production to serve build ${expectSha}`);
  const deadline = Date.now() + Number(process.env.DEPLOY_WAIT_SECONDS || 720) * 1000;
  let live = "";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/api/version`, { redirect: "follow", cache: "no-store" });
      if (res.ok) live = String((await res.json())?.id ?? "");
    } catch {}
    if (live === expectSha) break;
    await new Promise((r) => setTimeout(r, 15_000));
  }
  if (live === expectSha) console.log(`  production is on ${live}`);
  else warnings.push(`production still serving build ${live || "unknown"} after the deploy wait (expected ${expectSha}) — probes below judge the previous build`);
}

run("smoke:production", "npm", ["run", "smoke:production"], {
  env: { ...process.env, BASE_URL: baseUrl },
});

console.log("\n▶ /health/ready");
const ready = await fetchJson("/health/ready");
if (ready) {
  console.log(`  ready=${ready.ready}`);
  for (const c of ready.checks ?? []) {
    const icon = c.status === "pass" ? "✓" : c.status === "warn" ? "!" : "✗";
    console.log(`  ${icon} [${c.id}] ${c.label}`);
    if (c.status === "fail") failures.push(`readiness:${c.id}`);
    if (c.status === "warn") warnings.push(`readiness:${c.id} — ${c.detail ?? c.label}`);
  }
} else {
  warnings.push("/health/ready unavailable");
}

console.log("\n▶ /api/payment/config");
const pay = await fetchJson("/api/payment/config");
if (pay) {
  console.log(`  stripe enabled=${pay.enabled}`);
  if (!pay.enabled) warnings.push("Stripe not enabled on client — check Railway vars + redeploy");
} else {
  warnings.push("/api/payment/config unavailable (merge latest or redeploy)");
}

console.log("\n▶ custom domain probe");
for (const domain of ["https://peoplegoverned.com", "https://peoplegoverned.com/health"]) {
  try {
    const res = await fetch(domain, { redirect: "follow" });
    const isRailway = res.url.includes("railway.app") || res.url.includes("peoplegoverned.com");
    const ct = res.headers.get("content-type") || "";
    if (!res.ok) warnings.push(`${domain} → HTTP ${res.status}`);
    else if (domain.endsWith("/health") && !ct.includes("json"))
      warnings.push("peoplegoverned.com/health not app JSON — DNS may point to parking page");
    else console.log(`  ✓ ${domain} → ${res.status}`);
  } catch {
    warnings.push(`${domain} DNS unreachable`);
  }
}

console.log("\n" + "—".repeat(48));
if (warnings.length) {
  console.log("Warnings:");
  for (const w of warnings) console.log(`  ! ${w}`);
}
if (failures.length) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  ✗ ${f}`);
  console.log("\nAudit: RED — see docs/DAILY_AUDIT_PROMPT.md");
  process.exit(1);
}

console.log("\nAudit automated gates: GREEN (review warnings above)");
console.log("Next: run full agent prompt in docs/DAILY_AUDIT_AGENT_INVOKE.md");
