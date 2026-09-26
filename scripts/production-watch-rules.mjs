/**
 * What the server's own dependency report means for the outside watch.
 *
 * Kept apart from scripts/production-watch.mjs so it can be tested without
 * a network. The rule (corporate audit, #384): a configured critical
 * dependency being down is a FAILURE of this watch — the run goes red and
 * the page names the cause — not a note. Before this only the database
 * counted; Stripe or the map being down was written into a green run as a
 * remark, and a green run read as "a rider can use PG Ride" while nobody
 * could pay or see a map.
 *
 * What stays a note: a dependency that is not configured (Stripe on a
 * deployment that deliberately runs without it reports `configured: false`
 * and is never in `down`), the first check not having run yet on a freshly
 * started server, and slowness. The in-server watch pages these outages
 * too; the failure text says so, so two pages read as one outage.
 */

/** Plain names for the page, keyed by the server's dependency names. */
export const CRITICAL_DEPENDENCIES = {
  database: "Database",
  stripe: "Stripe",
  maps: "Map tiles",
};

/**
 * Judge one /health/deps answer.
 *
 * @param {{status: number, body: string, error?: string}} response  what the probe got back
 * @param {boolean} processAnswered  whether /health answered at all (an unreadable
 *   /health/deps on a server that is otherwise up is a failure; on a server
 *   that is down it is already counted by the /health probe)
 * @returns {{failures: string[], notes: string[]}}
 */
export function judgeDependencies(response, processAnswered) {
  const failures = [];
  const notes = [];
  if (response.status === 0) {
    if (processAnswered) failures.push(`Dependencies (/health/deps): ${response.error ?? "no answer"}`);
    return { failures, notes };
  }
  let report;
  try { report = JSON.parse(response.body || "{}"); }
  catch {
    if (processAnswered) failures.push(`Dependencies (/health/deps): HTTP ${response.status}, not JSON`);
    return { failures, notes };
  }
  const down = Array.isArray(report.down) ? report.down : [];
  // A server that has just started has not checked anything yet. That is
  // not an outage; the next run, ten minutes on, will see the first report.
  if (report.checkedAt === null && down.length === 0) {
    notes.push("dependencies: first check pending on a freshly started server");
    return { failures, notes };
  }
  for (const name of down) {
    const label = CRITICAL_DEPENDENCIES[name] ?? name;
    const why = report.deps?.[name]?.detail;
    // The reason travels with the name: "maps — MAPBOX_TOKEN is not set" is a
    // fix, "maps" is a worry. The server redacts keys before writing detail.
    failures.push(`${label} down: ${why ? String(why).slice(0, 160) : "the server reports it failing"} [the server has paged this too]`);
  }
  if (down.length === 0 && response.status === 503) {
    failures.push("Dependencies (/health/deps): HTTP 503 without naming what is down");
  } else if (down.length === 0 && response.status !== 200) {
    failures.push(`Dependencies (/health/deps): HTTP ${response.status}`);
  }
  return { failures, notes };
}
