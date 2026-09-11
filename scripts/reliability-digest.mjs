#!/usr/bin/env node
/**
 * Send the morning's reliability report to the ops Telegram chat.
 *
 * The full report goes to the rolling GitHub issue, which nobody reads at
 * six in the morning. This sends the digest (shared/reliabilityDigest.ts)
 * to the phone, with a link to the whole thing.
 *
 * Inert without TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID: it prints the digest
 * and exits 0, so a missing secret never turns the workflow red.
 *
 *   node scripts/reliability-digest.mjs reliability-report.md
 */
import { readFileSync } from "node:fs";
import { buildReliabilityDigest } from "../shared/reliabilityDigest.ts";

const path = process.argv[2] ?? "reliability-report.md";
let report = "";
try {
  report = readFileSync(path, "utf8");
} catch {
  report = "Report file missing — the reliability agent produced no output.";
}

const digest = buildReliabilityDigest({
  report,
  issueUrl: process.env.REPORT_URL || null,
  runUrl: process.env.RUN_URL || null,
});
console.log(digest);

const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
if (!token || !chatId) {
  console.log("\n[digest] Telegram is not configured; printed above only.");
  process.exit(0);
}

const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ chat_id: chatId, text: digest, disable_web_page_preview: true }),
}).catch((err) => ({ ok: false, status: 0, text: async () => String(err?.message ?? err) }));

if (!res.ok) {
  // A Telegram outage must not fail the reliability run; the report is
  // already on the issue either way.
  console.error(`[digest] Telegram send failed: ${res.status} ${await res.text().catch(() => "")}`.slice(0, 300));
  process.exit(0);
}
console.log("[digest] sent to the ops chat.");
