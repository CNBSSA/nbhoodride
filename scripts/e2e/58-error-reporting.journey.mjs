import http from "node:http";
import { Session, check, section, serverLog, startServer, stopServer, FIXTURES } from "./harness.mjs";

/**
 * Error reporting to Sentry (work order, Chairman 2026-10-27): opt-in, and
 * what leaves PG Ride is a stack trace and a scrubbed message — nothing that
 * identifies a person.
 *
 * Sentry is replaced by a sink on this machine's loopback address, so the
 * journey sees exactly the bytes that would have gone out:
 *   - off unless SENTRY_ENABLED=true AND a usable key (the key alone does nothing);
 *   - a key that is not https (or loopback) is refused, a garbage key never
 *     stops the server;
 *   - on, a test event arrives with its email, phone and street address
 *     scrubbed, and with no request data, cookies, breadcrumbs, host name or
 *     the admin's own details.
 */
function startSink() {
  const events = [];
  const srv = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      events.push({ url: req.url, body: Buffer.concat(chunks).toString("utf8") });
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  return new Promise((resolve) => srv.listen(0, "127.0.0.1", () => resolve({ srv, events, port: srv.address().port })));
}
const waitFor = async (fn, ms = 10_000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await new Promise((r) => setTimeout(r, 150)); } return false; };
const eventsIn = (sink) => sink.events.flatMap((e) => e.body.split("\n").map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((j) => j && j.exception));

export async function run({ base }) {
  const sink = await startSink();
  const dsn = `http://publickey123@127.0.0.1:${sink.port}/1`;
  const started = [];
  const boot = async (env) => { const s = await startServer(env); started.push(s); const admin = new Session(s.base); await admin.login(FIXTURES.admin.email); return { s, admin }; };
  try {
    section("Off by default: the main server has no key and says so");
    const main = new Session(base); await main.login(FIXTURES.admin.email);
    const st = await main.req("GET", "/api/admin/analytics/error-reporting");
    check("the admin sees error reporting is off", st.status === 200 && st.json?.enabled === false, JSON.stringify(st.json));
    const off = await main.req("POST", "/api/admin/analytics/error-reporting/test", {});
    check("a test event is refused with words that say how to turn it on", off.status === 200 && off.json?.enabled === false && /SENTRY_ENABLED=true/.test(off.json?.message ?? ""), JSON.stringify(off.json));
    const rider = new Session(base); await rider.login(FIXTURES.rider.email);
    check("a rider cannot read or send it", (await rider.req("GET", "/api/admin/analytics/error-reporting")).status >= 401 && (await rider.req("POST", "/api/admin/analytics/error-reporting/test", {})).status >= 401);

    section("A key without the switch does nothing");
    const keyOnly = await boot({ SENTRY_DSN: dsn });
    const k = await keyOnly.admin.req("POST", "/api/admin/analytics/error-reporting/test", {});
    check("the server runs with the key set and reporting off", k.json?.enabled === false, JSON.stringify(k.json));
    check("and says why in its log", /a key is set but SENTRY_ENABLED is not 'true'/.test(serverLog(keyOnly.s)));
    await new Promise((r) => setTimeout(r, 800));
    check("nothing reached Sentry", sink.events.length === 0, `${sink.events.length} requests`);

    section("A key that is not safe to send to is refused, and a bad key never stops the server");
    const plain = await boot({ SENTRY_ENABLED: "true", SENTRY_DSN: "http://publickey123@sentry.example.com/1" });
    check("plain http to another host is refused", (await plain.admin.req("GET", "/api/admin/analytics/error-reporting")).json?.enabled === false);
    const junk = await boot({ SENTRY_ENABLED: "true", SENTRY_DSN: "not a url at all" });
    check("a key that is not an address leaves the server up and reporting off", (await junk.admin.req("GET", "/api/admin/analytics/error-reporting")).json?.enabled === false && /error reporting is off/.test(serverLog(junk.s)));

    section("On: a test event arrives, scrubbed");
    const on = await boot({ SENTRY_ENABLED: "true", SENTRY_DSN: dsn, SENTRY_ENVIRONMENT: "e2e" });
    check("the admin sees it is on", (await on.admin.req("GET", "/api/admin/analytics/error-reporting")).json?.enabled === true);
    check("the log says it is on and never prints the key", /error reporting is ON/.test(serverLog(on.s)) && !serverLog(on.s).includes("publickey123"));
    const t = await on.admin.req("POST", "/api/admin/analytics/error-reporting/test", { note: "rider tunde@example.com, phone (240) 555-0147, picked up at 4301 Fairview Avenue" });
    check("the test event is sent", t.status === 200 && t.json?.enabled === true && t.json?.sent === true, JSON.stringify(t.json));
    const got = await waitFor(() => eventsIn(sink).length > 0);
    check("it reaches Sentry", got, `${sink.events.length} requests`);
    const ev = eventsIn(sink)[0] ?? {};
    const raw = sink.events.map((e) => e.body).join("\n");
    check("it is an error with a stack trace and the build it came from", ev.exception?.values?.[0]?.stacktrace?.frames?.length > 0 && typeof ev.release === "string" && ev.environment === "e2e", JSON.stringify({ release: ev.release, environment: ev.environment }));
    check("its message is the test event", /PG Ride test event, safe to ignore/.test(ev.exception?.values?.[0]?.value ?? ""), ev.exception?.values?.[0]?.value);
    check("the email, the phone and the street address were scrubbed", !/tunde|555-0147|Fairview/.test(raw) && /\[email\]/.test(raw) && /\[phone\]/.test(raw) && /\[address\]/.test(raw), (ev.exception?.values?.[0]?.value ?? "").slice(0, 200));
    check("no request data, cookies, breadcrumbs or user details went out", !ev.request && !ev.breadcrumbs && !ev.extra && !ev.user && !/cookie|connect\.sid|csrf/i.test(raw) && !raw.includes(FIXTURES.admin.email));
    check("the host name is replaced", ev.server_name === "pgride");
    check("only the allowed tags went out", JSON.stringify(Object.keys(ev.tags ?? {}).sort()) === JSON.stringify(["kind", "source"]), JSON.stringify(ev.tags));
  } finally {
    for (const s of started) stopServer(s);
    sink.srv.close();
  }
}
