/**
 * Anonymize user chat text before it's used as evidence in FAQ
 * generation prompts to Anthropic.
 *
 * The supervisor review of PR #40 caught that the prior version of this
 * scrubber only removed email, US-format phone, 5-digit ZIP, and dollar
 * amounts. It missed:
 *
 *   - Street addresses ("123 Main St")
 *   - International phone numbers
 *   - Credit card numbers (and other 13–19 digit runs)
 *   - SSNs
 *   - Latitude/longitude pairs
 *   - URLs (often contain emails / IDs in query strings)
 *
 * Per-row PII routinely shipped to Anthropic with the old scrubber, in
 * service of FAQ generation that doesn't need it. This rewrite over-
 * scrubs deliberately — false positives (a stray "[address]" token) are
 * acceptable because the downstream LLM is just summarizing common
 * questions, while false negatives (a real address landing in a logged
 * prompt) are not.
 *
 * Order matters: longer / more-specific patterns run first so they
 * aren't fragmented by the simpler patterns that follow. For example,
 * an email contains digits that the phone pattern would partially
 * match if it ran first.
 *
 * What this scrubber CANNOT do without DB context:
 *   - Match user-supplied full names against the users table to
 *     scrub them by name. Names of public figures, businesses, and
 *     places leak through. A future enhancement would pass the
 *     scrubber the rider's first/last name so it can elide their
 *     own name specifically.
 */

// Common US street suffixes (lower-case at apply time).
const STREET_SUFFIX_RE =
  "(?:st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|ln|lane|way|ct|court|cir|circle|pkwy|parkway|pl|place|hwy|highway|ter|terrace|alley|loop)";

export function anonymizeChatExcerpt(text: string): string {
  return text
    // URLs first — they may contain emails or PII in query strings.
    .replace(/\bhttps?:\/\/\S+/gi, "[url]")
    // Emails — second so they don't get fragmented by the phone regex.
    .replace(/\b[\w.+-]+@[\w.-]+\.\w{2,}\b/g, "[email]")
    // SSN-ish patterns (3-2-4 with dashes or spaces). Run before
    // generic digit-run so the dashes don't confuse it.
    .replace(/\b\d{3}[-.\s]\d{2}[-.\s]\d{4}\b/g, "[ssn]")
    // Credit card numbers — any 13-19 digit run, optionally separated
    // by space/dash every 4 digits. Catches Visa/MC/Amex/Discover
    // visually. Runs before phone so a credit card with hyphens isn't
    // first-pass-matched as a phone fragment.
    .replace(/\b(?:\d[ -]*?){13,19}\b/g, "[card]")
    // International phone numbers — +CC NNN NNN NNNN with various
    // separators. Runs before US-format phone to claim the leading +.
    .replace(/\+\d{1,3}[-.\s]?\(?\d{1,4}\)?(?:[-.\s]?\d{1,4}){2,4}/g, "[phone]")
    // US-format phone numbers — 3-3-4 with optional separators.
    .replace(/\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g, "[phone]")
    // Street addresses — number + word(s) + suffix. Loose; over-
    // matches into things like "5 Maple Drive" which is fine.
    .replace(new RegExp(`\\b\\d{1,6}\\s+[A-Za-z][A-Za-z\\s]{0,40}\\b${STREET_SUFFIX_RE}\\b\\.?`, "gi"), "[address]")
    // Lat/lng coordinate pairs (decimal degrees). Catches "38.9, -76.7"
    // style; the rider's home coords are the usual leak.
    .replace(/-?\d{1,3}\.\d{2,7}\s*[,;]\s*-?\d{1,3}\.\d{2,7}/g, "[coords]")
    // ZIP codes (5-digit + optional +4).
    .replace(/\b\d{5}(-\d{4})?\b/g, "[zip]")
    // Dollar amounts.
    .replace(/\$\d+(?:\.\d{2})?/g, "[amount]")
    // Collapse any whitespace introduced by the substitutions.
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function buildFaqExcerptBlock(excerpts: string[], maxChars = 12000): string {
  const lines: string[] = [];
  let total = 0;
  for (let i = 0; i < excerpts.length; i++) {
    const line = `- User: ${excerpts[i]}`;
    if (total + line.length > maxChars) break;
    lines.push(line);
    total += line.length;
  }
  if (lines.length === 0) {
    return "No recent user messages available yet.";
  }
  return lines.join("\n");
}
