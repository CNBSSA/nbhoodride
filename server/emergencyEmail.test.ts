import { describe, it, expect, vi, beforeEach } from "vitest";

// Capture what would be sent to Resend without a real key. We stub the module
// so sendEmail takes the "no resend configured" dev path — but that path logs
// and returns without exposing the HTML. Instead we spy on the Resend client
// by injecting a fake via the env + module mock.

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn().mockResolvedValue({ id: "test" }) }));

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));

// Ensure the module sees a key so it constructs the (mocked) Resend client.
process.env.RESEND_API_KEY = "test_key";
process.env.NODE_ENV = "test";

const { sendEmergencyAdminAlertEmail } = await import("./emailService");

describe("sendEmergencyAdminAlertEmail HTML injection", () => {
  beforeEach(() => sendMock.mockClear());

  it("escapes attacker-controlled incident fields in the email HTML", async () => {
    const res = await sendEmergencyAdminAlertEmail(
      [{ email: "admin@pgride.app", firstName: "Ada" }],
      {
        incidentType: "<img src=x onerror=alert(1)>",
        riderName: "<script>evil()</script>",
        riderPhone: "+1<b>555</b>",
        description: "help \"now\" <a href='javascript:bad()'>x</a>",
        location: { lat: 38.9, lng: -76.9 },
        shareToken: "tok123",
        createdAt: new Date("2026-08-03T00:00:00Z"),
      },
    );

    expect(res.sent).toBe(1);
    expect(sendMock).toHaveBeenCalledTimes(1);
    const html: string = sendMock.mock.calls[0][0].html;

    // No raw dangerous markup from user input survived.
    expect(html).not.toContain("<script>evil()</script>");
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    // The anchor tag is neutralized — no live href="javascript:" link survives.
    expect(html).not.toContain("<a href='javascript");
    expect(html).not.toContain('<a href="javascript');
    // Escaped forms are present instead.
    expect(html).toContain("&lt;script&gt;evil()&lt;/script&gt;");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("drops non-numeric coordinates instead of injecting them into the maps URL", async () => {
    await sendEmergencyAdminAlertEmail(
      [{ email: "admin@pgride.app", firstName: null }],
      {
        incidentType: "sos_button",
        riderName: "Rhea",
        riderPhone: null,
        description: null,
        // Attacker sends a string with markup where a number is expected.
        location: { lat: "1\"><script>x</script>" as any, lng: 2 as any },
        shareToken: "tok123",
        createdAt: null,
      },
    );
    const html: string = sendMock.mock.calls[0][0].html;
    expect(html).toContain("Location:</strong> Not available");
    expect(html).not.toContain("<script>x</script>");
  });

  it("returns {sent:0} with no recipients and never calls send", async () => {
    const res = await sendEmergencyAdminAlertEmail([], {
      incidentType: "sos_button", riderName: null, riderPhone: null,
      description: null, location: null, shareToken: null, createdAt: null,
    });
    expect(res).toEqual({ sent: 0, failed: 0 });
    expect(sendMock).not.toHaveBeenCalled();
  });
});
