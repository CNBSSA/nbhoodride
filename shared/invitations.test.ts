import { describe, expect, it } from "vitest";
import { INVITATION_DAYS, invitationExpiresAt, invitationRefusal, invitationState, safePortalNext } from "./invitations";

describe("an organization invitation", () => {
  const now = new Date("2026-09-16T12:00:00Z");
  it("lasts a week", () => {
    expect((invitationExpiresAt(now).getTime() - now.getTime()) / 86_400_000).toBe(INVITATION_DAYS);
  });
  it("is open until used or expired", () => {
    expect(invitationState({ expiresAt: invitationExpiresAt(now) }, now)).toBe("open");
    expect(invitationState({ expiresAt: invitationExpiresAt(now), acceptedAt: now }, now)).toBe("accepted");
    expect(invitationState({ expiresAt: new Date("2026-09-10T00:00:00Z") }, now)).toBe("expired");
  });
  it("tells the invitee why a link cannot be used, in words", () => {
    expect(invitationRefusal("open", "Books Expert LLC")).toBeNull();
    expect(invitationRefusal("accepted", "Books Expert LLC")).toMatch(/already been used/);
    expect(invitationRefusal("expired", "Books Expert LLC")).toMatch(/expired/);
  });
});

describe("where a business sign-in may land", () => {
  it("stays inside the portal", () => {
    expect(safePortalNext("/org?org=abc")).toBe("/org?org=abc");
    expect(safePortalNext("/org/join/x")).toBe("/org/join/x");
    expect(safePortalNext("/admin")).toBe("/org");
    expect(safePortalNext("//evil.example")).toBe("/org");
    expect(safePortalNext(null)).toBe("/org");
  });
});
