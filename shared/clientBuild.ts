/**
 * Was this crash reported by a phone running what we deployed, or one still
 * running the bundle it opened with yesterday?
 *
 * A browser keeps the JavaScript it loaded until something makes it refresh.
 * So every deploy has a tail: for hours afterwards, a few phones are still
 * running the old code and still hitting bugs that are already fixed. Without
 * telling the two apart, each of those reads to the operator exactly like a
 * fresh regression — they get paged at 2pm for something fixed at 3am, once
 * per rider, and learn to ignore the alerts. That is the real damage.
 *
 * Pure and unit-tested: given the two build ids, it says what the operator
 * needs to know and how the alert should be de-duplicated.
 */

export interface ClientBuildVerdict {
  /** The client is not running the build that is currently deployed. */
  stale: boolean;
  /** The line the operator reads. */
  text: string;
  /**
   * De-duplication scope. A stale build's crashes are keyed by the build, so
   * fifty phones on yesterday's bundle raise one alert rather than fifty; a
   * current-build crash stays keyed per rider, because that one is news.
   */
  keyPart: string;
}

const clean = (v: unknown): string => (typeof v === "string" ? v.trim().slice(0, 40) : "");

export function describeClientBuild(clientId: unknown, serverId: unknown): ClientBuildVerdict {
  const client = clean(clientId);
  const server = clean(serverId);

  // Nothing to compare against (local dev, or build-id.json missing): say so
  // rather than guessing, and do not claim a phone is out of date.
  if (!server || server === "dev") {
    return { stale: false, text: client ? `${client} (server build unknown)` : "not reported", keyPart: "" };
  }

  // A bundle old enough to predate build reporting is, by definition, old.
  if (!client) {
    return { stale: true, text: `not reported — older than this check; current is ${server}`, keyPart: "build:unknown" };
  }

  if (client === server) return { stale: false, text: `${client} (current)`, keyPart: "" };

  return { stale: true, text: `${client} — OUT OF DATE, current is ${server}`, keyPart: `build:${client}` };
}
