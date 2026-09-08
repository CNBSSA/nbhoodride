import { describe, expect, it } from "vitest";
import {
  DEFAULT_VEHICLE_FARE_MULTIPLIERS,
  describeVehicleFare,
  formatMultiplier,
  normalizeVehicleType,
  validateVehicleTypeInput,
  vehicleFareMultiplier,
  vehicleFareRuleSentence,
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

describe("vehicle-class pricing", () => {
  it("XL and SUV multiply the standard fare; Standard and wheelchair do not", () => {
    expect(vehicleFareMultiplier("standard")).toBe(1);
    expect(vehicleFareMultiplier("wheelchair")).toBe(1);
    expect(vehicleFareMultiplier("xl")).toBe(DEFAULT_VEHICLE_FARE_MULTIPLIERS.xl);
    expect(vehicleFareMultiplier("suv")).toBe(DEFAULT_VEHICLE_FARE_MULTIPLIERS.suv);
    expect(vehicleFareMultiplier(null)).toBe(1);
    expect(vehicleFareMultiplier("van")).toBe(1);
  });
  it("rate-card overrides win when sane, defaults otherwise", () => {
    expect(vehicleFareMultiplier("xl", { xlMultiplier: 1.4 })).toBe(1.4);
    expect(vehicleFareMultiplier("suv", { suvMultiplier: 2 })).toBe(2);
    expect(vehicleFareMultiplier("suv", { suvMultiplier: 0.5 })).toBe(1.8);
    expect(vehicleFareMultiplier("xl", { xlMultiplier: null })).toBe(1.5);
  });
  it("labels read the way a rider would say them", () => {
    expect(formatMultiplier(1.5)).toBe("1.5×");
    expect(formatMultiplier(2)).toBe("2×");
    expect(describeVehicleFare("xl")).toBe("1.5× the standard fare");
    expect(describeVehicleFare("suv", { suvMultiplier: 2 })).toBe("2× the standard fare");
    expect(describeVehicleFare("wheelchair")).toBe("Same fare as Standard");
    expect(vehicleFareRuleSentence()).toBe("XL rides are priced at 1.5× the standard fare and SUV rides at 1.8×; wheelchair-accessible rides cost the same as Standard. The fare shown before you confirm already includes this.");
  });
});
