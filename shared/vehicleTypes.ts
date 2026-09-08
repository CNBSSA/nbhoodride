/** Rider-requestable vehicle classes and driver matching rules. */

export const VEHICLE_TYPES = ["standard", "xl", "suv", "wheelchair"] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

export const VEHICLE_TYPE_LABELS: Record<VehicleType, string> = {
  standard: "Standard",
  xl: "XL",
  suv: "SUV",
  wheelchair: "Wheelchair accessible",
};

export const VEHICLE_TYPE_DESCRIPTIONS: Record<VehicleType, string> = {
  standard: "Everyday sedan — most rides",
  xl: "Extra legroom for groups or luggage",
  suv: "SUV or larger vehicle",
  wheelchair: "Ramp or lift-equipped vehicle",
};

/** Normalize unknown DB values to a safe default. */
export function normalizeVehicleType(value: string | null | undefined): VehicleType {
  if (value && (VEHICLE_TYPES as readonly string[]).includes(value)) {
    return value as VehicleType;
  }
  return "standard";
}

/**
 * Whether a driver's vehicle satisfies the rider's request.
 * Standard accepts any non-wheelchair-only fleet; specialized types need capability.
 */
export function vehicleTypeMatches(
  requested: VehicleType | null | undefined,
  driverType: string | null | undefined,
): boolean {
  const req = requested ? normalizeVehicleType(requested) : "standard";
  const offered = normalizeVehicleType(driverType);

  if (req === "standard") {
    return offered !== "wheelchair";
  }
  if (req === "xl") {
    return offered === "xl" || offered === "suv";
  }
  if (req === "suv") {
    return offered === "suv" || offered === "xl";
  }
  return offered === "wheelchair";
}

export function validateVehicleTypeInput(
  value: unknown,
): { valid: boolean; type?: VehicleType; error?: string } {
  if (value === undefined || value === null || value === "") {
    return { valid: true, type: "standard" };
  }
  if (typeof value !== "string") {
    return { valid: false, error: "Invalid vehicle type" };
  }
  if (!(VEHICLE_TYPES as readonly string[]).includes(value)) {
    return { valid: false, error: `Vehicle type must be one of: ${VEHICLE_TYPES.join(", ")}` };
  }
  return { valid: true, type: value as VehicleType };
}

/** Filter driver rows that have at least one matching vehicle. */
export function filterDriversByVehicleType<T extends { vehicles: Array<{ vehicleType?: string | null }> }>(
  drivers: T[],
  requested?: VehicleType | string | null,
): T[] {
  const req = requested ? normalizeVehicleType(requested) : "standard";
  if (req === "standard") {
    return drivers.filter((d) => vehicleTypeMatches(req, d.vehicles[0]?.vehicleType));
  }
  return drivers.filter((d) =>
    d.vehicles.some((v) => vehicleTypeMatches(req, v.vehicleType)),
  );
}

// ── Vehicle-class pricing ────────────────────────────────────────────────
// XL and SUV rides cost more than the standard fare: the whole standard
// fare (base + time + distance, after the minimum) is multiplied. The
// multipliers live on the platform rate card (admin-editable); these are
// the defaults and the fallback. Wheelchair-accessible rides are priced the
// same as Standard on purpose — accessibility is not an upgrade.

export const DEFAULT_VEHICLE_FARE_MULTIPLIERS: Record<VehicleType, number> = {
  standard: 1,
  xl: 1.5,
  suv: 1.8,
  wheelchair: 1,
};

export interface VehicleRateOptions {
  xlMultiplier?: number | null;
  suvMultiplier?: number | null;
}

const sane = (v: number | null | undefined, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) && v >= 1 && v <= 5 ? v : fallback;

export function vehicleFareMultiplier(type: VehicleType | string | null | undefined, rates: VehicleRateOptions = {}): number {
  const t = normalizeVehicleType(type ?? undefined);
  if (t === "xl") return sane(rates.xlMultiplier, DEFAULT_VEHICLE_FARE_MULTIPLIERS.xl);
  if (t === "suv") return sane(rates.suvMultiplier, DEFAULT_VEHICLE_FARE_MULTIPLIERS.suv);
  return 1;
}

/** "1.5×" — trims trailing zeros. */
export function formatMultiplier(m: number): string {
  return `${Number(m.toFixed(2))}×`;
}

/** Short fare label for a picker option. */
export function describeVehicleFare(type: VehicleType, rates: VehicleRateOptions = {}): string {
  if (type === "standard") return "Standard fare";
  if (type === "wheelchair") return "Same fare as Standard";
  return `${formatMultiplier(vehicleFareMultiplier(type, rates))} the standard fare`;
}

/** One sentence for the picker, the business page and the Terms. */
export function vehicleFareRuleSentence(rates: VehicleRateOptions = {}): string {
  return `XL rides are priced at ${formatMultiplier(vehicleFareMultiplier("xl", rates))} the standard fare and SUV rides at ${formatMultiplier(vehicleFareMultiplier("suv", rates))}; wheelchair-accessible rides cost the same as Standard. The fare shown before you confirm already includes this.`;
}
