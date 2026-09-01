import { describe, expect, it } from "vitest";
import {
  ANNOUNCEMENT_BODY_MAX,
  ANNOUNCEMENT_TITLE_MAX,
  checkAnnouncement,
  matchesAudience,
} from "./announcementPolicy";

const base = { title: "Service paused", body: "Snow — no rides tonight.", audience: "all" };

describe("checkAnnouncement", () => {
  it("accepts a well-formed announcement and trims whitespace", () => {
    const res = checkAnnouncement({ ...base, title: "  Service paused  " });
    expect(res.valid).toBe(true);
    if (res.valid) {
      expect(res.title).toBe("Service paused");
      expect(res.audience).toBe("all");
      expect(res.targetUserIds).toEqual([]);
    }
  });

  it("requires a title and a body", () => {
    expect(checkAnnouncement({ ...base, title: "   " })).toEqual({ valid: false, error: "A title is required." });
    expect(checkAnnouncement({ ...base, body: "" })).toEqual({ valid: false, error: "A message is required." });
  });

  it("enforces length limits", () => {
    expect(checkAnnouncement({ ...base, title: "x".repeat(ANNOUNCEMENT_TITLE_MAX + 1) }).valid).toBe(false);
    expect(checkAnnouncement({ ...base, body: "x".repeat(ANNOUNCEMENT_BODY_MAX + 1) }).valid).toBe(false);
  });

  it("rejects an unknown audience", () => {
    expect(checkAnnouncement({ ...base, audience: "everyone-ish" }).valid).toBe(false);
  });

  it("requires recipients when targeting specific people, and de-duplicates them", () => {
    expect(checkAnnouncement({ ...base, audience: "specific", targetUserIds: [] }).valid).toBe(false);
    const res = checkAnnouncement({ ...base, audience: "specific", targetUserIds: ["a", "a", " b ", "", 7] });
    expect(res.valid).toBe(true);
    if (res.valid) expect(res.targetUserIds).toEqual(["a", "b"]);
  });
});

describe("matchesAudience", () => {
  const rider = { isDriver: false };
  const driver = { isDriver: true };

  it("routes riders and drivers to their own audiences", () => {
    expect(matchesAudience(rider, "riders")).toBe(true);
    expect(matchesAudience(rider, "drivers")).toBe(false);
    expect(matchesAudience(driver, "drivers")).toBe(true);
    expect(matchesAudience(driver, "riders")).toBe(false);
  });

  it("includes everyone for all/specific", () => {
    for (const u of [rider, driver]) {
      expect(matchesAudience(u, "all")).toBe(true);
      expect(matchesAudience(u, "specific")).toBe(true);
    }
  });

  it("never delivers to deleted or suspended accounts, whatever the audience", () => {
    for (const audience of ["all", "riders", "drivers", "specific"] as const) {
      expect(matchesAudience({ isDriver: false, deletedAt: new Date() }, audience)).toBe(false);
      expect(matchesAudience({ isDriver: true, isSuspended: true }, audience)).toBe(false);
    }
  });
});
