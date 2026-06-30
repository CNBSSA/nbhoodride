/**
 * Pins the closed enum of allowed GenUI button actions.
 *
 * The supervisor review of PR #40 flagged that `action: z.string().max(80)`
 * let a compromised `ride_surface_cache` row emit any string, which the
 * client `RideSurface` renderer then dispatches to its `onAction`
 * callback. If `RiderDashboard` later adds a handler for "logout" or
 * "delete_account", a poisoned spec could trigger it silently.
 *
 * This test exists so the action enum can't be widened back to a free
 * string without a deliberate code change that breaks the test.
 */
import { describe, it, expect } from "vitest";
import { rideSurfaceSpecSchema } from "./genui/schema";

describe("GenUI action enum (post-supervisor review)", () => {
  it("accepts a button with a known whitelisted action", () => {
    const spec = {
      version: 1,
      title: "Trip Complete",
      nodes: [{ type: "button", action: "rate_ride", label: "Rate" }],
    };
    expect(() => rideSurfaceSpecSchema.parse(spec)).not.toThrow();
  });

  it("rejects a button with an unknown action — the whole point of the enum", () => {
    const spec = {
      version: 1,
      title: "Trip Complete",
      nodes: [{ type: "button", action: "logout", label: "Bye" }],
    };
    expect(() => rideSurfaceSpecSchema.parse(spec)).toThrow();
  });

  it("rejects empty action — must be a known enum value", () => {
    const spec = {
      version: 1,
      title: "Trip Complete",
      nodes: [{ type: "button", action: "", label: "Tap" }],
    };
    expect(() => rideSurfaceSpecSchema.parse(spec)).toThrow();
  });

  it("rejects HTML-ish payloads as actions", () => {
    const spec = {
      version: 1,
      title: "Trip Complete",
      nodes: [{ type: "button", action: "<script>alert(1)</script>", label: "Tap" }],
    };
    expect(() => rideSurfaceSpecSchema.parse(spec)).toThrow();
  });
});
