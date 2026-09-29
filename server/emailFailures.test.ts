import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("./telegramOps", () => ({ opsAlert: vi.fn(), formatOpsAlert: (t: string, f: any[]) => [t, ...f.map(([l, v]: any) => `${l}: ${v}`)].join("\n") }));
vi.mock("./reliabilityEvents", () => ({ recordReliabilityEvent: vi.fn(async () => {}) }));

import { emailFailureClass, shouldPageEmailFailure, _resetEmailFailureState, emailFailureRecorder, EMAIL_FAILURE_PAGE_WINDOW_MS } from "./emailFailures";
import { opsAlert } from "./telegramOps";
import { recordReliabilityEvent } from "./reliabilityEvents";

describe("a failed email", () => {
  beforeEach(() => { _resetEmailFailureState(); vi.clearAllMocks(); });

  it("is classed by what went wrong, not by its wording", () => {
    expect(emailFailureClass("Email service is not configured. SMTP_PASS (the Gmail app password) is missing.")).toBe("not_configured");
    expect(emailFailureClass("550-5.4.5 Daily user sending limit exceeded")).toBe("quota");
    expect(emailFailureClass("Invalid login: 535-5.7.8 Username and Password not accepted")).toBe("auth");
    expect(emailFailureClass("connect ECONNREFUSED 127.0.0.1:9")).toBe("connection");
    expect(emailFailureClass("something else")).toBe("other");
  });

  it("pages once an hour per kind of email and class of reason", () => {
    const t0 = 1_000_000;
    expect(shouldPageEmailFailure("Reset your password", "connect ECONNREFUSED", t0)).toBe(true);
    expect(shouldPageEmailFailure("Reset your password", "connect ETIMEDOUT", t0 + 1000)).toBe(false);
    expect(shouldPageEmailFailure("Your account is approved", "connect ECONNREFUSED", t0 + 1000)).toBe(true);
    expect(shouldPageEmailFailure("Reset your password", "Invalid login", t0 + 2000)).toBe(true);
    expect(shouldPageEmailFailure("Reset your password", "connect ECONNREFUSED", t0 + EMAIL_FAILURE_PAGE_WINDOW_MS)).toBe(true);
  });

  it("the recorder pages the first and records every one", () => {
    emailFailureRecorder({ to: "a@example.com", subject: "Reset your password", reason: "connect ECONNREFUSED 127.0.0.1:9", attempts: 2 });
    emailFailureRecorder({ to: "b@example.com", subject: "Reset your password", reason: "connect ECONNREFUSED 127.0.0.1:9", attempts: 2 });
    expect(opsAlert).toHaveBeenCalledTimes(1);
    expect(String((opsAlert as any).mock.calls[0][0])).toMatch(/Email FAILED[\s\S]*a@example.com[\s\S]*connection/);
    expect(recordReliabilityEvent).toHaveBeenCalledTimes(2);
    expect((recordReliabilityEvent as any).mock.calls[1][0]).toMatchObject({ kind: "email_failed", page: "Reset your password" });
  });
});
