#!/usr/bin/env node
/**
 * Phase 0 production smoke checks — public routes and readiness endpoint.
 *
 * Usage:
 *   npm run smoke:production
 *   BASE_URL=https://pgride.com npm run smoke:production
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const baseUrl = (process.env.BASE_URL || "https://nbhoodride-production.up.railway.app").replace(
  /\/+$/,
  "",
);

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "client", "public", "manifest.json"), "utf8"));

const failures = [];
const warnings = [];

async function check(name, url, { expectStatus = 200, optional = false } = {}) {
  try {
    const res = await fetch(url, { redirect: "follow" });
    if (res.status !== expectStatus) {
      const msg = `${name}: expected HTTP ${expectStatus}, got ${res.status} (${url})`;
      if (optional) warnings.push(msg);
      else failures.push(msg);
      return null;
    }
    console.log(`✓ ${name}`);
    return res;
  } catch (err) {
    const msg = `${name}: ${err instanceof Error ? err.message : String(err)} (${url})`;
    if (optional) warnings.push(msg);
    else failures.push(msg);
    return null;
  }
}

async function main() {
  console.log(`Phase 0 smoke — ${baseUrl}\n`);

  const health = await check("GET /health", `${baseUrl}/health`);
  if (health) {
    const body = await health.json();
    if (body.status !== "ok") failures.push(`/health body.status !== ok`);
  }

  const readyRes = await check("GET /health/ready", `${baseUrl}/health/ready`, { optional: true });
  if (readyRes) {
    const contentType = readyRes.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      warnings.push("/health/ready returned HTML — deploy latest main for automated readiness");
    } else {
      const ready = await readyRes.json();
      console.log(`  readiness.ready = ${ready.ready}`);
      for (const c of ready.checks ?? []) {
        const icon = c.status === "pass" ? "✓" : c.status === "warn" ? "!" : "✗";
        console.log(`  ${icon} [${c.id}] ${c.label}${c.detail ? ` — ${c.detail}` : ""}`);
        if (c.status === "fail") failures.push(`readiness ${c.id}: ${c.detail ?? c.label}`);
      }
    }
  } else {
    warnings.push("Deploy /health/ready (merge latest) for automated Phase 0 status");
  }

  await check("GET /login", `${baseUrl}/login`);
  await check("GET /signup", `${baseUrl}/signup`);
  await check("GET /privacy", `${baseUrl}/privacy`);
  await check("GET /terms", `${baseUrl}/terms`);
  await check("GET /admin/setup", `${baseUrl}/admin/setup`);
  await check("GET /api/csrf", `${baseUrl}/api/csrf`);
  await check("GET /manifest.json", `${baseUrl}/manifest.json`);

  for (const icon of manifest.icons ?? []) {
    await check(`icon ${icon.sizes}`, `${baseUrl}${icon.src}`);
  }

  for (const shot of manifest.screenshots ?? []) {
    await check(`screenshot ${shot.label}`, `${baseUrl}${shot.src}`, { optional: true });
  }

  // Custom domain probe (optional)
  for (const domain of ["https://pgride.com", "https://pgride.app"]) {
    try {
      const res = await fetch(`${domain}/health`, { redirect: "follow" });
      if (res.ok) console.log(`✓ custom domain ${domain}`);
      else warnings.push(`${domain} returned HTTP ${res.status}`);
    } catch {
      warnings.push(`${domain} DNS not resolving yet`);
    }
  }

  console.log("");
  if (warnings.length) {
    console.log("Warnings:");
    for (const w of warnings) console.log(`  ! ${w}`);
    console.log("");
  }

  if (failures.length) {
    console.error("Failures:");
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }

  console.log("Phase 0 public smoke checks passed.");
}

main();
