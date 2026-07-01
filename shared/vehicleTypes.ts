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
