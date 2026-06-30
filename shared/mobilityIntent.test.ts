import { describe, expect, it } from "vitest";
import { parseMobilityUtterance } from "./mobilityIntent";
import { rideSurfaceSpecSchema } from "./genui/schema";

describe("parseMobilityUtterance", () => {
  it("detects ride home", () => {
    const r = parseMobilityUtterance("Take me home please");
    expect(r.intentType).toBe("ride_home");
    expect(r.confidence).toBeGreaterThan(0.8);
  });

  it("detects repeat last ride", () => {
    expect(parseMobilityUtterance("Same as last time").intentType).toBe("repeat_last");
  });

  it("extracts destination from ride to phrase", () => {
    const r = parseMobilityUtterance("I need a ride to Bowie Town Center");
    expect(r.intentType).toBe("ride_to");
    expect(r.destinationAddress).toContain("Bowie");
  });

  it("detects guardian share", () => {
    expect(parseMobilityUtterance("Share my ride with family").intentType).toBe("guardian_share");
  });
});

describe("rideSurfaceSpecSchema", () => {
  it("validates a minimal surface", () => {
    const spec = rideSurfaceSpecSchema.parse({
      version: 1,
      title: "Ride in progress",
      nodes: [
        { type: "heading", text: "On the way" },
        { type: "metric", label: "ETA", value: "8 min" },
      ],
    });
    expect(spec.nodes).toHaveLength(2);
  });
});
