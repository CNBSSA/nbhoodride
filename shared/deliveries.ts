/**
 * Deliveries — a job with no passenger.
 *
 * A law office sends a deed across the county; a print shop sends proofs.
 * Nobody rides: there is a pickup contact, a drop contact, a parcel and a
 * window. The driver hands it over and records who took it, which is the
 * same signature a medical job takes at the facility.
 *
 * Deliveries carry their own tariff, because a parcel is not a person: a
 * flat fare covering the first few miles, then a rate per mile. The driver
 * still keeps 85%, exactly as on a ride.
 */

export const PARCEL_SIZES = ["envelope", "small", "medium", "large"] as const;
export type ParcelSize = (typeof PARCEL_SIZES)[number];

export const PARCEL_LABELS: Record<ParcelSize, string> = {
  envelope: "Envelope or documents",
  small: "Small box, up to a shoebox",
  medium: "Medium box, up to a carry-on",
  large: "Large, needs a seat down or a boot",
};

/** What the driver needs to know before claiming it. */
export const PARCEL_NOTES: Record<ParcelSize, string> = {
  envelope: "Fits in a hand; any car.",
  small: "Fits on a seat; any car.",
  medium: "Fits in most boots; any car.",
  large: "Ask for an estate, an XL or an SUV.",
};

/** A large parcel is quoted for a bigger vehicle unless the desk says otherwise. */
export const SIZE_VEHICLE_HINT: Record<ParcelSize, string> = {
  envelope: "standard", small: "standard", medium: "standard", large: "xl",
};

export const isParcelSize = (v: unknown): v is ParcelSize => PARCEL_SIZES.includes(v as ParcelSize);

export interface DeliveryRates {
  /** Covers everything up to baseMiles. */
  baseFare: number;
  baseMiles: number;
  perMile: number;
}

export const DELIVERY_RATES: DeliveryRates = { baseFare: 9, baseMiles: 3, perMile: 1.6 };

const round2 = (n: number) => Math.round(n * 100) / 100;

/** What a single-drop delivery costs the account, before any facility fee. */
export function deliveryFare(miles: number, rates: DeliveryRates = DELIVERY_RATES): number {
  const m = Number.isFinite(miles) && miles > 0 ? miles : 0;
  const extra = Math.max(0, m - rates.baseMiles);
  return round2(rates.baseFare + extra * rates.perMile);
}

export function describeDeliveryTariff(rates: DeliveryRates = DELIVERY_RATES): string {
  return `$${rates.baseFare.toFixed(2)} covers the first ${rates.baseMiles} miles, then $${rates.perMile.toFixed(2)} a mile.`;
}

/** How wide a delivery window is when the desk does not say. */
export const DEFAULT_WINDOW_HOURS = 2;
/** The soonest a delivery can be asked for. */
export const MIN_LEAD_MINUTES = 45;

export interface Contact {
  name: string;
  phone?: string | null;
  note?: string | null;
}

export interface DeliveryInput {
  parcelSize: string;
  pickupContact: Contact;
  dropContact: Contact;
  /** When the parcel is ready; the window runs from here. */
  readyAt: string | Date;
  windowHours?: number | null;
}

export interface DeliveryWindow {
  start: Date;
  end: Date;
  hours: number;
}

const cleanName = (v: unknown) => String((v as any) ?? "").trim().slice(0, 120);

export function validateDelivery(input: DeliveryInput, now: Date = new Date()): { valid: true; window: DeliveryWindow } | { valid: false; error: string } {
  if (!isParcelSize(input.parcelSize)) return { valid: false, error: "Pick what is being sent: envelope, small, medium or large." };
  if (!cleanName(input.pickupContact?.name)) return { valid: false, error: "Who hands the parcel over? A pickup contact is needed." };
  if (!cleanName(input.dropContact?.name)) return { valid: false, error: "Who receives it? A drop contact is needed." };
  const start = new Date(input.readyAt);
  if (Number.isNaN(start.getTime())) return { valid: false, error: "When is the parcel ready?" };
  if (start.getTime() < now.getTime() + MIN_LEAD_MINUTES * 60_000 - 60_000) {
    return { valid: false, error: `A delivery is booked at least ${MIN_LEAD_MINUTES} minutes ahead.` };
  }
  const hours = Number(input.windowHours ?? DEFAULT_WINDOW_HOURS);
  if (!Number.isFinite(hours) || hours < 1 || hours > 12) return { valid: false, error: "The window must be between 1 and 12 hours." };
  return { valid: true, window: { start, end: new Date(start.getTime() + hours * 3_600_000), hours } };
}

const clock = (d: Date) => d.toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });

/** "Ready 2:00 PM, deliver by 4:00 PM" — what the driver's card says. */
export function describeWindow(window: { start: Date | string; end: Date | string }): string {
  return `Ready ${clock(new Date(window.start))}, deliver by ${clock(new Date(window.end))}`;
}

/** One line for the driver: what it is and who takes it. */
export function describeParcel(size: string, dropContactName?: string | null): string {
  const label = isParcelSize(size) ? PARCEL_LABELS[size] : "Parcel";
  return dropContactName ? `${label} · hand to ${dropContactName}` : label;
}

export interface DeliveryProof {
  receivedBy?: string;
  photoUrl?: string;
  signedAt?: string;
}

/** A delivery is not finished until someone is named as having taken it. */
export function proofComplete(proof: DeliveryProof | null | undefined): boolean {
  return !!proof?.receivedBy && !!proof.signedAt;
}
