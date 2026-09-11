import { describe, expect, it } from "vitest";
import { DIGEST_MAX, buildReliabilityDigest, readReport, verdictOf } from "./reliabilityDigest";

const healthy = `# PG Ride Daily Reliability Report — 2026-09-10

## Build / type / test
- npm run check exit code: 0 (clean)
- npm test exit code: 0 (passing)
  Tests  296 passed (296)

## Production probes
- /health/ready: HTTP 200 — {"ready":true,"checks":[{"label":"PostgreSQL reachable","status":"pass"},{"label":"Emergency SMS (Twilio)","status":"pass"}]}

## Branch parity (origin/develop ↔ origin/main)
- left-right count (developOnly mainOnly): 0\t1

## Dependency audit
- npm audit: total 14 (critical 0, high 0, moderate 14, low 0)
`;

const withWarnings = healthy.replace(
  '{"label":"Emergency SMS (Twilio)","status":"pass"}',
  '{"label":"Password reset by text (Twilio Verify)","status":"warn"},{"label":"SMS opt-out webhook (TCPA)","status":"warn"}',
);

const broken = healthy
  .replace("npm test exit code: 0 (passing)", "npm test exit code: 1 (failing)")
  .replace("/health/ready: HTTP 200", "/health/ready: HTTP 503");

describe("reading the report", () => {
  it("pulls out the numbers that matter", () => {
    const f = readReport(healthy);
    expect(f.date).toBe("2026-09-10");
    expect(f.checkExit).toBe("0");
    expect(f.tests).toBe("296 passed");
    expect(f.ready).toBe(true);
    expect(f.audit).toContain("total 14");
    expect(f.parity).toContain("0");
    expect(f.warnings).toEqual([]);
    expect(f.aiSkipped).toBe(false);
  });
  it("finds every warning and failure by name", () => {
    expect(readReport(withWarnings).warnings).toEqual(["Password reset by text (Twilio Verify)", "SMS opt-out webhook (TCPA)"]);
    const f = readReport(healthy.replace('"status":"pass"}]', '"status":"fail"}]'));
    expect(f.failures.length).toBe(1);
  });
  it("notices when the written analysis was skipped", () => {
    expect(readReport("⚠️ AI analysis skipped: ANTHROPIC_API_KEY secret is not set").aiSkipped).toBe(true);
  });
});

describe("the verdict", () => {
  it("green when nothing is wrong", () => {
    expect(verdictOf(readReport(healthy))).toMatchObject({ emoji: "🟢", bad: false });
  });
  it("amber for things still to set up, not red", () => {
    const v = verdictOf(readReport(withWarnings));
    expect(v.emoji).toBe("🟡");
    expect(v.bad).toBe(false);
    expect(v.text).toContain("2 things");
  });
  it("red when tests fail or production is not ready", () => {
    const v = verdictOf(readReport(broken));
    expect(v.emoji).toBe("🔴");
    expect(v.bad).toBe(true);
    expect(v.text).toContain("tests failing");
    expect(v.text).toContain("production not ready");
  });
});

describe("the message", () => {
  it("leads with the verdict and names what is unfinished", () => {
    const msg = buildReliabilityDigest({ report: withWarnings, issueUrl: "https://github.com/x/y/issues/178" });
    expect(msg.split("\n")[0]).toBe("🛰 Daily Reliability Report — 2026-09-10");
    expect(msg).toContain("🟡");
    expect(msg).toContain("Tests: 296 passed");
    expect(msg).toContain("⚠️ SMS opt-out webhook (TCPA)");
    expect(msg).toContain("Full report: https://github.com/x/y/issues/178");
  });
  it("says so when the analysis was skipped, and how to fix it", () => {
    const msg = buildReliabilityDigest({ report: "AI analysis skipped: ANTHROPIC_API_KEY secret is not set" });
    expect(msg).toContain("ANTHROPIC_API_KEY is not set as a repository secret");
  });
  it("always fits one Telegram message", () => {
    const huge = healthy + "\n" + Array.from({ length: 400 }, (_, i) => `{"label":"Check ${i}","status":"warn"}`).join("\n");
    const msg = buildReliabilityDigest({ report: huge });
    expect(msg.length).toBeLessThanOrEqual(DIGEST_MAX);
    expect(msg).toContain("truncated");
  });
});
