#!/usr/bin/env node
/**
 * PG Ride — durable daily Reliability Agent (Path B).
 *
 * Runs in GitHub Actions on a schedule (see
 * .github/workflows/daily-reliability-agent.yml), so it is completely
 * independent of any Claude session or platform Routine — it cannot silently
 * stop the way a session-only scheduler can.
 *
 * What it does:
 *   1. Gathers deterministic evidence (build/type/test health, live production
 *      health + payment config probes, git develop↔main parity, recent commits,
 *      npm audit summary).
 *   2. Sends that evidence to the Claude API with the audit playbook
 *      (docs/DAILY_AUDIT_PROMPT.md) and asks for a report in the standard
 *      format, tagging findings P0/P1/P2 and [RIDER]/[DRIVER]/[ADMIN]/
 *      [PAYMENT]/[SAFETY]/[INFRA].
 *   3. Writes the report to reliability-report.md (the workflow posts it to a
 *      GitHub Issue).
 *
 * Scope note: this is an analysis pass, not the full flow-walking agent — it
 * reasons over evidence and probes rather than booting the app and clicking
 * through it. It never writes code and never touches production data.
 *
 * Graceful degradation: if ANTHROPIC_API_KEY is absent the deterministic
 * evidence is still gathered and written to the report with a clear note that
 * AI analysis is pending the secret — the workflow stays green so it never
 * red-alerts merely because the key hasn't been added yet.
 */
import { spawnSync } from "node:child_process";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const baseUrl = (process.env.BASE_URL || "https://nbhoodride-production.up.railway.app").replace(/\/+$/, "");
const OUT = join(root, "reliability-report.md");
const today = new Date().toISOString().slice(0, 10);

const MODEL = process.env.RELIABILITY_MODEL || "claude-sonnet-5";
const API_KEY = process.env.ANTHROPIC_API_KEY || "";

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: root, encoding: "utf8", shell: false, ...opts });
  return { code: r.status ?? -1, out: `${r.stdout || ""}${r.stderr || ""}`.trim() };
}

async function tryFetch(path) {
  try {
    const res = await fetch(`${baseUrl}${path}`, { redirect: "follow" });
    const ct = res.headers.get("content-type") || "";
    const body = ct.includes("json") ? JSON.stringify(await res.json()) : `<non-JSON HTTP ${res.status}>`;
    return `HTTP ${res.status} — ${body}`;
  } catch (e) {
    return `unreachable (${e.message})`;
  }
}

// ── 1. Gather deterministic evidence ────────────────────────────────────────
console.log("Gathering evidence…");

sh("git", ["fetch", "origin", "develop", "main"], { stdio: "ignore" });
const parity = sh("git", ["rev-list", "--left-right", "--count", "origin/develop...origin/main"]);
const recentCommits = sh("git", ["log", "origin/main", "--oneline", "-15"]);

const checkRes = sh("npm", ["run", "check"]);
const testRes = sh("npm", ["test"]);

// Phase 0 public + legal-route smoke against production. This is the check the
// 0.4-legal / 0.6-smoke readiness warns used to say "run manually" — it's
// read-only (GET /privacy, /terms, /login, /signup, /health, CSRF, manifest,
// icons) so it's safe to run on every scheduled report, making the legal-route
// and public-route status deterministic daily instead of manual-only.
const smokeRes = sh("npm", ["run", "smoke:production"]);

const health = await tryFetch("/health/ready");
const payCfg = await tryFetch("/api/payment/config");

const auditRaw = sh("npm", ["audit", "--json"]);
let auditSummary = "unavailable";
try {
  const a = JSON.parse(auditRaw.out);
  const v = a.metadata?.vulnerabilities || {};
  auditSummary = `total ${v.total ?? "?"} (critical ${v.critical ?? 0}, high ${v.high ?? 0}, moderate ${v.moderate ?? 0}, low ${v.low ?? 0})`;
} catch {
  /* npm audit exits non-zero when vulns exist; JSON may still be partial */
}

const playbook = existsSync(join(root, "docs/DAILY_AUDIT_PROMPT.md"))
  ? readFileSync(join(root, "docs/DAILY_AUDIT_PROMPT.md"), "utf8")
  : "(playbook not found)";

const evidence = `# Evidence bundle — ${today}

## Build / type / test
- npm run check exit code: ${checkRes.code} ${checkRes.code === 0 ? "(clean)" : "(FAILING)"}
- npm test exit code: ${testRes.code} ${testRes.code === 0 ? "(passing)" : "(FAILING)"}
- npm test tail:
${testRes.out.split("\n").slice(-8).join("\n")}

## Production probes (${baseUrl})
- /health/ready: ${health}
- /api/payment/config: ${payCfg}

## Production smoke — public + legal routes (${baseUrl})
- npm run smoke:production exit code: ${smokeRes.code} ${smokeRes.code === 0 ? "(passing)" : "(FAILING — see tail)"}
- smoke tail:
${smokeRes.out.split("\n").slice(-14).join("\n")}

## Branch parity (origin/develop ↔ origin/main)
- left-right count (developOnly mainOnly): ${parity.out || "unknown"}

## Recent main commits
${recentCommits.out}

## Dependency audit
- npm audit: ${auditSummary}
`;

// ── 2. Call Claude for the structured report ────────────────────────────────
function degradedReport(reason) {
  return `# PG Ride Daily Reliability Report — ${today}

> ⚠️ AI analysis skipped: ${reason}
> The deterministic evidence below was still gathered. Add an \`ANTHROPIC_API_KEY\`
> repo secret to enable the full AI reliability analysis.

${evidence}
`;
}

async function main() {
  if (!API_KEY) {
    writeFileSync(OUT, degradedReport("ANTHROPIC_API_KEY secret is not set"));
    console.log("No API key — wrote deterministic-only report.");
    return;
  }

  const system =
    "You are the PG Ride Daily Reliability Agent. You are given the team's audit " +
    "playbook and a bundle of freshly-gathered evidence (build/test health, live " +
    "production probes, git parity, recent commits, dependency audit). Produce a " +
    "report in EXACTLY the 'Required report format' from the playbook. Be concise " +
    "and evidence-based: only claim what the evidence supports, and explicitly mark " +
    "anything you could not verify (you cannot run a browser or query the DB, so " +
    "rider/driver flow checks are CODE-ONLY/analysis, not live runs). Tag every " +
    "finding [RIDER] [DRIVER] [ADMIN] [PAYMENT] [SAFETY] [INFRA] and severity " +
    "P0/P1/P2. Never invent metrics you don't have — say 'not available (no DB " +
    "access from CI)'. Start the report RED only if a deterministic gate actually failed.";

  const userMsg =
    `Audit playbook:\n\n${playbook}\n\n---\n\nEvidence gathered today:\n\n${evidence}\n\n` +
    "Write the report now in the required format.";

  let reportBody;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 3000,
        system,
        messages: [{ role: "user", content: userMsg }],
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      // Do not leak the key; errText from Anthropic never contains it.
      writeFileSync(OUT, degradedReport(`Claude API returned HTTP ${res.status}: ${errText.slice(0, 300)}`));
      console.log(`API error HTTP ${res.status} — wrote degraded report.`);
      return;
    }
    const data = await res.json();
    reportBody = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    if (!reportBody) {
      writeFileSync(OUT, degradedReport("Claude API returned an empty response"));
      return;
    }
  } catch (e) {
    writeFileSync(OUT, degradedReport(`Claude API call threw: ${e.message}`));
    console.log("API call threw — wrote degraded report.");
    return;
  }

  const footer =
    `\n\n---\n_Generated by the durable Daily Reliability Agent ` +
    `(.github/workflows/daily-reliability-agent.yml, model ${MODEL}). ` +
    `Analysis pass over evidence + production probes — not a live flow-walk._`;
  writeFileSync(OUT, reportBody + footer);
  console.log("Wrote AI reliability report.");
}

main().catch((e) => {
  // Never hard-fail the workflow on the agent's own error — write what we have.
  writeFileSync(OUT, degradedReport(`agent script error: ${e.message}`));
  console.error("Agent error (non-fatal):", e.message);
});
