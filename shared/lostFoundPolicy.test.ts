import { describe, expect, it } from "vitest";
import { canTransitionLostFound, OPEN_LOST_FOUND_STATUSES } from "./lostFoundPolicy";

describe("lostFoundPolicy", () => {
  it("allows driver to mark item found", () => {
    expect(canTransitionLostFound("driver_notified", "driver_has_item", "driver")).toBe(true);
  });

  it("blocks rider from closing as not found", () => {
    expect(canTransitionLostFound("reported", "closed_not_found", "rider")).toBe(false);
  });

  it("allows admin any valid status", () => {
    expect(canTransitionLostFound("reported", "closed_no_response", "admin")).toBe(true);
  });

  it("tracks open statuses", () => {
    expect(OPEN_LOST_FOUND_STATUSES.has("driver_has_item")).toBe(true);
    expect(OPEN_LOST_FOUND_STATUSES.has("returned")).toBe(false);
  });
});
