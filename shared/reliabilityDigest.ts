/**
 * The daily reliability report, cut down to something a phone can show.
 *
 * The full report is a long evidence bundle and lives as a comment on the
 * rolling GitHub issue. Nobody reads a GitHub issue at six in the morning,
 * so this makes a digest that fits one Telegram message: the verdict, what
 * is failing or warning, the numbers that changed, and a link to the whole
 * thing.
 *
 * Pure and unit-tested: given the report's markdown, it returns the message.
 */

/** Telegram's hard cap; leave room for the footer. */
export const DIGEST_MAX = 3500;

export interface DigestInput {
  /** The full report markdown. */
  report: string;
  /** Where the full report can be read. */
  issueUrl?: string | null;
  /** The run that produced it, for a failure. */
  runUrl?: string | null;
}

const firstMatch = (text: string, re: RegExp): string | null => {
  const m = re.exec(text);
  return m ? (m[1] ?? m[0]).trim() : null;
};

export interface DigestFacts {
  date: string | null;
  checkExit: string | null;
  testExit: string | null;
  tests: string | null;
  ready: boolean | null;
  warnings: string[];
  failures: string[];
  audit: string | null;
  parity: string | null;
  aiSkipped: boolean;
  /** Why it was skipped, in the report's own words. */
  aiSkipReason: string | null;
}

/** Pull the few things worth waking up to out of the evidence bundle. */
export function readReport(report: string): DigestFacts {
  const labelled = (status: "warn" | "fail") =>
    Array.from(report.matchAll(new RegExp(`"label":"([^"]+)","status":"${status}"`, "g"))).map((m) => m[1]);
  return {
    date: firstMatch(report, /Daily Reliability Report — (\d{4}-\d{2}-\d{2})/),
    checkExit: firstMatch(report, /npm run check exit code: (\d+)/),
    testExit: firstMatch(report, /npm test exit code: (\d+)/),
    tests: firstMatch(report, /Tests[^\d]*(\d+ passed)/),
    ready: /\/health\/ready: HTTP 200/.test(report) ? true : /\/health\/ready: HTTP \d+/.test(report) ? false : null,
    warnings: labelled("warn"),
    failures: labelled("fail"),
    audit: firstMatch(report, /npm audit: (total \d+[^\n]*)/),
    parity: firstMatch(report, /left-right count \(developOnly mainOnly\): ([^\n]+)/),
    aiSkipped: /AI analysis skipped/.test(report),
    aiSkipReason: firstMatch(report, /AI analysis skipped:\s*([^\n]+)/),
  };
}

/**
 * The verdict line. Anything that would make a rider's app misbehave is red;
 * configuration still to finish is amber; otherwise green.
 */
export function verdictOf(f: DigestFacts): { emoji: string; text: string; bad: boolean } {
  const broken: string[] = [];
  if (f.checkExit && f.checkExit !== "0") broken.push("build/typecheck failing");
  if (f.testExit && f.testExit !== "0") broken.push("tests failing");
  if (f.ready === false) broken.push("production not ready");
  if (f.failures.length > 0) broken.push(`${f.failures.length} readiness check failing`);
  if (broken.length > 0) return { emoji: "🔴", text: broken.join(", "), bad: true };
  if (f.warnings.length > 0) return { emoji: "🟡", text: `healthy, ${f.warnings.length} thing${f.warnings.length === 1 ? "" : "s"} still to set up`, bad: false };
  return { emoji: "🟢", text: "everything healthy", bad: false };
}

/** The message sent to the ops chat each morning. */
export function buildReliabilityDigest(input: DigestInput): string {
  const f = readReport(input.report ?? "");
  const v = verdictOf(f);
  const lines: string[] = [
    `🛰 Daily Reliability Report${f.date ? ` — ${f.date}` : ""}`,
    `${v.emoji} ${v.text}`,
    "",
    `Build: ${f.checkExit === "0" ? "clean" : `FAILING (exit ${f.checkExit ?? "?"})`} · Tests: ${f.testExit === "0" ? (f.tests ?? "passing") : `FAILING (exit ${f.testExit ?? "?"})`}`,
    `Production: ${f.ready === true ? "ready" : f.ready === false ? "NOT READY" : "not probed"}`,
  ];
  if (f.parity) lines.push(`develop↔main (ahead/behind): ${f.parity}`);
  if (f.audit) lines.push(`Dependencies: ${f.audit}`);

  if (f.failures.length > 0) {
    lines.push("", "Failing:");
    for (const x of f.failures) lines.push(`  ❌ ${x}`);
  }
  if (f.warnings.length > 0) {
    lines.push("", "Still to set up:");
    for (const x of f.warnings) lines.push(`  ⚠️ ${x}`);
  }
  if (f.aiSkipped) {
    // Say what actually went wrong. This line used to assert the key was
    // missing whatever the reason, which sent a morning's debugging at the
    // wrong problem: the key was set, and the API had returned nothing.
    const why = f.aiSkipReason ? f.aiSkipReason.replace(/\s+$/, "") : "reason not recorded";
    lines.push("", `Note: the written analysis was skipped — ${why}. Only the raw evidence was gathered.`);
  }
  if (input.issueUrl) lines.push("", `Full report: ${input.issueUrl}`);
  else if (input.runUrl) lines.push("", `Run: ${input.runUrl}`);

  const text = lines.join("\n");
  return text.length > DIGEST_MAX ? `${text.slice(0, DIGEST_MAX - 20)}\n… (truncated)` : text;
}
