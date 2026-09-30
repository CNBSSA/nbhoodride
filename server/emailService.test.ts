import { describe, it, expect, vi, beforeEach } from "vitest";

// Nodemailer is stubbed so nothing ever leaves a test; the transport options
// and every message are recorded instead (reliability audit 2026-09-29).
const { sendMock, createMock } = vi.hoisted(() => ({
  sendMock: vi.fn().mockResolvedValue({ messageId: "test" }),
  createMock: vi.fn(),
}));
vi.mock("nodemailer", () => {
  const createTransport = (opts: unknown) => { createMock(opts); return { sendMail: sendMock }; };
  return { default: { createTransport }, createTransport };
});

process.env.SMTP_PASS = "test-app-password";
process.env.EMAIL_REPLY_TO = "PG Ride Support <support@example.com>";
process.env.NODE_ENV = "test";

const mod = await import("./emailService");
const html = () => String(sendMock.mock.calls[0][0].html);

describe("email templates", () => {
  beforeEach(() => sendMock.mockClear());

  it("escape a driver's name and the addresses in a rider's receipt", async () => {
    await mod.sendRideReceiptEmail({
      riderEmail: "r@example.com", riderFirstName: "<b>Ada</b>", driverName: "<img src=x onerror=alert(1)>",
      pickupAddress: "12 Oak St <script>", destinationAddress: "9 Elm & Main", actualFare: "12.00", promoDiscountApplied: null, completedAt: new Date(),
    });
    const h = html();
    expect(h).not.toContain("<img src=x");
    expect(h).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(h).toContain("&lt;b&gt;Ada&lt;/b&gt;");
    expect(h).toContain("12 Oak St &lt;script&gt;");
    expect(h).toContain("9 Elm &amp; Main");
  });

  it("escape the organization and inviter in an invitation, link included", async () => {
    await mod.sendOrganizationInviteEmail({ email: "d@example.com", organizationName: "Clinic <script>x</script>", inviterName: "Eve \"<i>\"", link: "https://pgride.app/org/join/abc?x=1&y=2", days: 7 });
    const h = html();
    expect(h).not.toContain("<script>x</script>");
    expect(h).toContain("Clinic &lt;script&gt;x&lt;/script&gt;");
    expect(h).toContain("Eve &quot;&lt;i&gt;&quot;");
    expect(h).toContain("https://pgride.app/org/join/abc?x=1&amp;y=2");
  });

  it("invite a fleet's driver to drive, not to book (2026-09-30)", async () => {
    await mod.sendOrganizationInviteEmail({ email: "d@example.com", organizationName: "Acme <Fleet>", inviterName: "Eve", link: "https://pgride.app/org/join/abc", days: 7, role: "driver" });
    const h = html();
    const subject = (sendMock.mock.calls.at(-1)?.[0] as any)?.subject as string;
    expect(subject).toBe("Acme <Fleet> invited you to drive for their fleet on PG Ride");
    expect(h).toContain("drive one of <strong>Acme &lt;Fleet&gt;</strong>");
    expect(h).toMatch(/PG Ride checks and approves every driver itself/);
    expect(h).toMatch(/75% to you and 25% to the fleet, and every tip is yours/);
    expect(h).not.toMatch(/book rides/);
  });

  it("still invite a booking account's people to book", async () => {
    await mod.sendOrganizationInviteEmail({ email: "d@example.com", organizationName: "Clinic", inviterName: null, link: "https://pgride.app/org/join/abc", days: 7 });
    expect((sendMock.mock.calls.at(-1)?.[0] as any)?.subject).toBe("Clinic invited you to book rides on PG Ride");
    expect(html()).toMatch(/book rides and deliveries/);
  });

  it("escape the driver's details when a ride is accepted", async () => {
    await mod.sendRideAcceptedEmail({ riderEmail: "r@example.com", riderFirstName: "Ada", driverName: "<b>Sam</b>", driverPhone: "<u>555</u>", vehicleDescription: "<i>Camry</i>", pickupAddress: "A", destinationAddress: "B", estimatedFare: "10.00", promoDiscount: null });
    const h = html();
    expect(h).toContain("&lt;b&gt;Sam&lt;/b&gt;");
    expect(h).toContain("&lt;u&gt;555&lt;/u&gt;");
    expect(h).toContain("&lt;i&gt;Camry&lt;/i&gt;");
  });
});

describe("the transport", () => {
  beforeEach(() => sendMock.mockClear());

  it("is pooled with a few connections, not one per message", () => {
    const opts = createMock.mock.calls[0][0] as any;
    expect(opts.pool).toBe(true);
    expect(opts.maxConnections).toBeLessThanOrEqual(3);
    expect(opts.maxMessages).toBeGreaterThan(1);
    expect(opts.requireTLS).toBe(true);
  });

  it("sets Reply-To from EMAIL_REPLY_TO and counts what it sent", async () => {
    const before = mod.getEmailConfigSummary().sentToday;
    await mod.sendTestEmail("t@example.com");
    expect(sendMock.mock.calls[0][0].replyTo).toBe("support@example.com");
    const summary = mod.getEmailConfigSummary();
    expect(summary.replyTo).toBe("support@example.com");
    expect(summary.sentToday).toBe(before + 1);
    expect(summary.dailyLimitHint).toBe(500);
  });
});

describe("retrying a failed send", () => {
  beforeEach(() => sendMock.mockClear());

  it("retries a connection failure once", async () => {
    sendMock.mockRejectedValueOnce(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED", command: "CONN" }));
    const r = await mod.sendTestEmail("t@example.com");
    expect(r.ok).toBe(true);
    expect(sendMock).toHaveBeenCalledTimes(2);
  }, 10_000);

  it("never retries after the message was handed over, so nothing is delivered twice", async () => {
    sendMock.mockRejectedValueOnce(Object.assign(new Error("Timeout - closing connection"), { code: "ETIMEDOUT", command: "DATA" }));
    const r = await mod.sendTestEmail("t@example.com");
    expect(r.ok).toBe(false);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("classes the errors the way the rule says", () => {
    expect(mod.isRetryableSmtpError({ command: "AUTH" })).toBe(true);
    expect(mod.isRetryableSmtpError({ code: "ETIMEDOUT" })).toBe(true);
    expect(mod.isRetryableSmtpError({ command: "DATA", code: "ETIMEDOUT" })).toBe(false);
    expect(mod.isRetryableSmtpError({ responseCode: 550 })).toBe(false);
    expect(mod.isRetryableSmtpError(null)).toBe(false);
  });
});
