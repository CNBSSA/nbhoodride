import { Session, check, section, serverLog, startServer, stopServer, FIXTURES, tinyPng } from "./harness.mjs";

/**
 * Code review 2026-10-06, platform items (issue #469):
 * - a malformed csrf_token cookie is no token (403), not a server error;
 * - one account may upload at most so many files an hour (the database
 *   holds them);
 * - the request log never carries a successful response's body (a person's
 *   email, phone or address).
 * The minute-sweep overlap guard, the WebSocket join race and the
 * migration's lock timeout have no outside effect a journey can force; the
 * full suite runs on all three.
 */
export async function run({ base, server }) {
  section("A malformed security cookie is refused, not a server error");
  const res = await fetch(base + "/api/rides/calculate-fare", {
    method: "POST",
    headers: { "X-Forwarded-Proto": "https", "Content-Type": "application/json", Cookie: "csrf_token=%E0%A4%A", "X-CSRF-Token": "x" },
    body: "{}",
  });
  check("a cookie that cannot be decoded gets a 403", res.status === 403, `${res.status}`);

  section("The request log keeps errors, not people's details");
  const rider = new Session(base); await rider.login(FIXTURES.rider.email);
  const me = await rider.req("GET", "/api/auth/user");
  await new Promise((r) => setTimeout(r, 300));
  const log = serverLog(server);
  check("the rider's own details were served", me.status === 200 && me.json?.email === FIXTURES.rider.email, `${me.status}`);
  check("and their email is not in the request log", !log.split("\n").some((l) => l.includes("GET /api/auth/user 200") && l.includes(FIXTURES.rider.email)));

  section("One account may upload only so many files an hour");
  const small = await startServer({ UPLOAD_RATE_LIMIT_MAX: "2" });
  try {
    const s = new Session(small.base); await s.login(FIXTURES.rider.email);
    const put = async () => {
      const up = await s.req("POST", "/api/objects/upload?store=db", {});
      const path = new URL(up.json?.uploadURL ?? "http://x/").pathname;
      return (await s.req("PUT", path, tinyPng(), { "Content-Type": "image/png" })).status;
    };
    const statuses = [await put(), await put(), await put()];
    check("two uploads are taken and the third in the hour is refused", statuses[0] === 200 && statuses[1] === 200 && statuses[2] === 429, JSON.stringify(statuses));
  } finally { await stopServer(small); }
}
