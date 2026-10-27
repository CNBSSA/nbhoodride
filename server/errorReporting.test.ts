import { describe, expect, it } from "vitest";
import { acceptableDsnHost, errorReportingEnabled, initErrorReporting, reportError } from "./errorReporting";

describe("which keys error reporting will send to", () => {
  it("accepts https", () => {
    expect(acceptableDsnHost("https://abc123@o1.ingest.sentry.io/42")).toBe("o1.ingest.sentry.io");
  });
  it("accepts plain http only to this machine", () => {
    expect(acceptableDsnHost("http://abc@127.0.0.1:9000/1")).toBe("127.0.0.1");
    expect(acceptableDsnHost("http://abc@sentry.example.com/1")).toBeNull();
  });
  it("refuses a key with no public part, or no address at all", () => {
    expect(acceptableDsnHost("https://o1.ingest.sentry.io/42")).toBeNull();
    expect(acceptableDsnHost("not a url")).toBeNull();
    expect(acceptableDsnHost(undefined)).toBeNull();
  });
});

describe("opt-in", () => {
  it("stays off with a key but no switch", async () => {
    expect(await initErrorReporting({ SENTRY_DSN: "https://abc@o1.ingest.sentry.io/42" } as any)).toBe(false);
    expect(errorReportingEnabled()).toBe(false);
  });
  it("stays off with the switch but no usable key", async () => {
    expect(await initErrorReporting({ SENTRY_ENABLED: "true", SENTRY_DSN: "nonsense" } as any)).toBe(false);
    expect(await initErrorReporting({ SENTRY_ENABLED: "true" } as any)).toBe(false);
  });
  it("only the exact word 'true' turns it on", async () => {
    expect(await initErrorReporting({ SENTRY_ENABLED: "1", SENTRY_DSN: "https://abc@o1.ingest.sentry.io/42" } as any)).toBe(false);
    expect(await initErrorReporting({ SENTRY_ENABLED: "TRUE", SENTRY_DSN: "https://abc@o1.ingest.sentry.io/42" } as any)).toBe(false);
  });
  it("reports nothing while off, and never throws", () => {
    expect(reportError(new Error("x"))).toBe(false);
    expect(reportError(undefined, { kind: "express" })).toBe(false);
  });
});
