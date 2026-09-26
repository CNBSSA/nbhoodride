import { describe, expect, it } from "vitest";
import { judgeDependencies } from "./production-watch-rules.mjs";

const answer = (obj, status = obj.down?.length ? 503 : 200) => ({ status, body: JSON.stringify(obj) });
const dep = (ok, configured = true, detail) => ({ ok, ms: 12, configured, detail });

describe("judgeDependencies", () => {
  it("is quiet when everything configured is up", () => {
    const r = judgeDependencies(answer({ checkedAt: "2026-09-26T10:00:00Z", deps: { database: dep(true), stripe: dep(true), maps: dep(true) }, down: [] }), true);
    expect(r).toEqual({ failures: [], notes: [] });
  });

  it("goes red when the database is down, with the reason", () => {
    const r = judgeDependencies(answer({ checkedAt: "x", deps: { database: dep(false, true, "connection refused") }, down: ["database"] }), true);
    expect(r.failures).toEqual(["Database down: connection refused [the server has paged this too]"]);
  });

  it("goes red when the map is down: a blank map is no ride", () => {
    const r = judgeDependencies(answer({ checkedAt: "x", deps: { maps: dep(false, true, "MAPBOX_TOKEN is not set") }, down: ["maps"] }), true);
    expect(r.failures[0]).toMatch(/^Map tiles down: MAPBOX_TOKEN is not set/);
  });

  it("goes red when a CONFIGURED Stripe is down", () => {
    const r = judgeDependencies(answer({ checkedAt: "x", deps: { stripe: dep(false, true, "Invalid API Key provided: sk_test_***") }, down: ["stripe"] }), true);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]).toMatch(/^Stripe down: Invalid API Key/);
  });

  it("stays green for a deployment that deliberately runs without Stripe", () => {
    // The server never lists an unconfigured dependency as down.
    const r = judgeDependencies(answer({ checkedAt: "x", deps: { stripe: dep(true, false, "not configured"), database: dep(true) }, down: [] }), true);
    expect(r.failures).toEqual([]);
  });

  it("names every dependency that is down, so one page reads whole", () => {
    const r = judgeDependencies(answer({ checkedAt: "x", deps: { stripe: dep(false, true, "unreachable"), maps: dep(false, true, "rate limited") }, down: ["stripe", "maps"] }), true);
    expect(r.failures.map((f) => f.split(" down")[0])).toEqual(["Stripe", "Map tiles"]);
  });

  it("treats the first check still pending on a fresh server as a note, not an outage", () => {
    const r = judgeDependencies(answer({ checkedAt: null, deps: {}, down: [], note: "first check pending" }, 200), true);
    expect(r.failures).toEqual([]);
    expect(r.notes[0]).toMatch(/first check pending/);
  });

  it("is red on a 503 that names nothing, and on an unreadable answer from a server that is otherwise up", () => {
    expect(judgeDependencies(answer({ checkedAt: "x", deps: {}, down: [] }, 503), true).failures[0]).toMatch(/without naming/);
    expect(judgeDependencies({ status: 200, body: "<html>" }, true).failures[0]).toMatch(/not JSON/);
    expect(judgeDependencies({ status: 0, body: "", error: "no answer within 15s" }, true).failures[0]).toMatch(/no answer within 15s/);
  });

  it("does not double count a server that is down altogether", () => {
    // /health already failed; a dead /health/deps adds nothing.
    expect(judgeDependencies({ status: 0, body: "", error: "ECONNREFUSED" }, false)).toEqual({ failures: [], notes: [] });
  });

  it("recovers: a later clean report has no failures", () => {
    const down = judgeDependencies(answer({ checkedAt: "x", deps: { stripe: dep(false, true, "down") }, down: ["stripe"] }), true);
    const up = judgeDependencies(answer({ checkedAt: "y", deps: { stripe: dep(true) }, down: [] }), true);
    expect(down.failures).toHaveLength(1);
    expect(up.failures).toHaveLength(0);
  });
});
