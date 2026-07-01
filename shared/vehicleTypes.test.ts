import { describe, expect, it } from "vitest";
import {
  normalizeVehicleType,
  validateVehicleTypeInput,
  vehicleTypeMatches,
} from "./vehicleTypes";

describe("vehicleTypeMatches", () => {
  it("standard accepts sedans and xl/suv but not wheelchair-only", () => {
    expect(vehicleTypeMatches("standard", "standard")).toBe(true);
    expect(vehicleTypeMatches("standard", "xl")).toBe(true);
    expect(vehicleTypeMatches("standard", "wheelchair")).toBe(false);
  });

  it("xl and suv are cross-compatible", () => {
    expect(vehicleTypeMatches("xl", "suv")).toBe(true);
    expect(vehicleTypeMatches("suv", "xl")).toBe(true);
    expect(vehicleTypeMatches("xl", "standard")).toBe(false);
  });

  it("wheelchair requires exact match", () => {
    expect(vehicleTypeMatches("wheelchair", "wheelchair")).toBe(true);
    expect(vehicleTypeMatches("wheelchair", "suv")).toBe(false);
  });

  it("missing request defaults to standard rules", () => {
    expect(vehicleTypeMatches(undefined, "standard")).toBe(true);
    expect(vehicleTypeMatches(null, "wheelchair")).toBe(false);
  });
});

describe("normalizeVehicleType", () => {
  it("falls back to standard for unknown values", () => {
    expect(normalizeVehicleType("bogus")).toBe("standard");
    expect(normalizeVehicleType(null)).toBe("standard");
  });
});

describe("validateVehicleTypeInput", () => {
  it("accepts valid types and empty", () => {
    expect(validateVehicleTypeInput("suv").valid).toBe(true);
    expect(validateVehicleTypeInput("").type).toBe("standard");
  });

  it("rejects invalid types", () => {
    expect(validateVehicleTypeInput("van").valid).toBe(false);
  });
});
