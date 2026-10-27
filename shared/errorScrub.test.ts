import { describe, expect, it } from "vitest";
import { errorStatus, isExpectedError, safeTags, safeUserId, scrubEvent, scrubText } from "./errorScrub";

describe("scrubText", () => {
  it("removes emails, phones and addresses", () => {
    const s = scrubText("Could not text (240) 555-0147 or mail tunde@example.com about pickup at 4301 Fairview Avenue");
    expect(s).not.toMatch(/555|tunde|example\.com|Fairview/);
    expect(s).toContain("[phone]");
    expect(s).toContain("[email]");
    expect(s).toContain("[address]");
  });

  it("removes coordinates, keys and connection strings", () => {
    const s = scrubText("at 38.907312, -76.778100 using sk_live_abc123XYZ and postgres://pgride:hunter2@db.internal:5432/pgride");
    expect(s).not.toMatch(/38\.907|sk_live|hunter2|db\.internal/);
  });

  it("removes bearer tokens and long opaque strings", () => {
    const s = scrubText("Authorization: Bearer abc.def-ghi_jkl and token 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08");
    expect(s).not.toMatch(/abc\.def|9f86d081/);
  });

  it("keeps a uuid, which is an id and makes a report debuggable", () => {
    const id = "3f2c1d9e-8a47-4b6c-9d10-5e7a2b1c0f33";
    expect(scrubText(`ride ${id} failed`)).toContain(id);
  });

  it("keeps an ordinary technical message", () => {
    expect(scrubText("Cannot read properties of undefined (reading 'riderId')")).toBe("Cannot read properties of undefined (reading 'riderId')");
  });

  it("clips a long message", () => {
    expect(scrubText("x".repeat(5000)).length).toBeLessThanOrEqual(1000);
  });
});

describe("expected errors", () => {
  it("treats a 4xx and a validation failure as the client's mistake", () => {
    expect(isExpectedError({ status: 404 })).toBe(true);
    expect(isExpectedError({ statusCode: 409 })).toBe(true);
    expect(isExpectedError({ name: "ZodError" })).toBe(true);
  });
  it("treats a 5xx, or no status, as PG Ride's fault", () => {
    expect(isExpectedError({ status: 500 })).toBe(false);
    expect(isExpectedError(new Error("boom"))).toBe(false);
  });
  it("reads a status only when it is one", () => {
    expect(errorStatus({ status: "502" })).toBe(502);
    expect(errorStatus({ status: "soon" })).toBeNull();
    expect(errorStatus(null)).toBeNull();
  });
});

describe("tags and user", () => {
  it("lets through only the allowed tags, scrubbed", () => {
    expect(safeTags({ kind: "express", route: "POST /api/rides", email: "a@b.co", job: "tunde@example.com" }))
      .toEqual({ kind: "express", route: "POST /api/rides", job: "[email]" });
  });
  it("sends a user id only when it is opaque", () => {
    expect(safeUserId("e2e-rider")).toBe("e2e-rider");
    expect(safeUserId("tunde@example.com")).toBeUndefined();
    expect(safeUserId("Tunde Payee")).toBeUndefined();
    expect(safeUserId(42)).toBeUndefined();
  });
});

describe("scrubEvent", () => {
  const event = {
    event_id: "abc", level: "error", platform: "node", release: "b123", environment: "production",
    server_name: "railway-host-7f3",
    request: { url: "https://x/api/rides?phone=2405550147", headers: { cookie: "sid=secret" }, data: { name: "Tunde" } },
    user: { id: "u-1", email: "tunde@example.com", ip_address: "203.0.113.9", username: "tunde" },
    breadcrumbs: [{ message: "GET /api/rides for tunde@example.com" }],
    extra: { riderName: "Tunde Payee" },
    contexts: { runtime: { name: "node", version: "v22.1.0" }, device: { name: "host" }, os: { name: "Linux" } },
    tags: { kind: "express", route: "GET /api/rides", secret: "x" },
    exception: { values: [{ type: "Error", value: "No driver for tunde@example.com at 12 Main Street", stacktrace: { frames: [{ filename: "/app/dist/index.js", function: "f", lineno: 10, colno: 3, in_app: true, vars: { a: "tunde" }, context_line: "const phone = '2405550147'", pre_context: ["x"], post_context: ["y"] }] } }] },
  };

  it("drops request data, headers, breadcrumbs, extra data and device details", () => {
    const out = scrubEvent(event)!;
    const json = JSON.stringify(out);
    expect(out.request).toBeUndefined();
    expect(out.breadcrumbs).toBeUndefined();
    expect(out.extra).toBeUndefined();
    expect(json).not.toMatch(/tunde|Tunde|2405550147|203\.0\.113|cookie|secret|railway-host|Fairview|Main Street/);
    expect(out.server_name).toBe("pgride");
  });

  it("keeps what makes it debuggable", () => {
    const out = scrubEvent(event)!;
    expect(out.user).toEqual({ id: "u-1" });
    expect(out.release).toBe("b123");
    expect(out.contexts).toEqual({ runtime: { name: "node", version: "v22.1.0" } });
    expect(out.tags).toEqual({ kind: "express", route: "GET /api/rides" });
    expect(out.exception.values[0].value).toBe("No driver for [email] at [address]");
    expect(out.exception.values[0].stacktrace.frames[0]).toEqual({ filename: "/app/dist/index.js", function: "f", lineno: 10, colno: 3, in_app: true });
  });

  it("does not change the event it was given", () => {
    scrubEvent(event);
    expect(event.request.data.name).toBe("Tunde");
    expect(event.exception.values[0].stacktrace.frames[0].vars).toBeDefined();
  });

  it("drops an event it cannot scrub", () => {
    const bad: any = { exception: { values: [{ value: "x" }] } };
    bad.self = bad; // a cycle structuredClone handles; use something it cannot
    bad.fn = () => 1;
    expect(scrubEvent(bad)).toBeNull();
  });
});
