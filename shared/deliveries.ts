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
  /** person | reception | unattended; missing means hand to the person. */
  handover?: string | null;
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
  if (input.handover !== undefined && input.handover !== null && !isHandoverKind(input.handover)) return { valid: false, error: "How does it change hands? Hand to the person, leave with reception, or leave at the door." };
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


// ── Handover and proof (2026-09-17) ─────────────────────────────────────────
//
// How the parcel changes hands is a field, not a note, because it decides
// what proof the driver must give. Festus's rule: a photo is required only
// when nobody signs for it.

export const HANDOVER_KINDS = ["person", "reception", "unattended"] as const;
export type HandoverKind = (typeof HANDOVER_KINDS)[number];
export const DEFAULT_HANDOVER: HandoverKind = "person";

export const HANDOVER_LABELS: Record<HandoverKind, string> = {
  person: "Hand to the named person",
  reception: "Leave with reception or the front desk",
  unattended: "Leave at the door (driver takes a photo)",
};

export const isHandoverKind = (v: unknown): v is HandoverKind => HANDOVER_KINDS.includes(v as HandoverKind);
export const handoverOf = (v: unknown): HandoverKind => (isHandoverKind(v) ? v : DEFAULT_HANDOVER);

/** The first line on the driver's card. */
export function describeHandover(handover: unknown, dropName?: string | null): string {
  switch (handoverOf(handover)) {
    case "person": return `Hand it to ${dropName || "the named person"} and record their name`;
    case "reception": return "Leave it with reception or the front desk and record who took it";
    case "unattended": return "Leave it at the door and take a photo of where you left it";
  }
}

export interface ProofRequirement { needsName: boolean; needsPhoto: boolean }

export function proofRequirement(handover: unknown): ProofRequirement {
  const kind = handoverOf(handover);
  return { needsName: kind !== "unattended", needsPhoto: kind === "unattended" };
}

export interface DeliveryProof {
  receivedBy?: string | null;
  photoUrl?: string | null;
  /** The photo is on the driver's phone, not yet uploaded (no signal at the door). */
  photoPending?: boolean;
  note?: string | null;
  signedAt?: string;
  signedBy?: string;
  lat?: number | null;
  lng?: number | null;
  distanceFromDropMeters?: number | null;
  /** Recorded further from the drop address than PROOF_DISTANCE_FLAG_METERS. Flagged, never blocked: GPS indoors is unreliable. */
  farFromDrop?: boolean;
  /** When the photo reached the server, which can be after the handover (no signal at the door). */
  photoUploadedAt?: string | null;
  /** The pending photo never came within a day; ops was paged. */
  photoNeverArrived?: boolean;
  /** The photo was deleted after the retention period; the record stays. */
  photoRetired?: boolean;
  photoRetiredAt?: string | null;
}

/** A proof recorded this far from the drop address is flagged to the desk. */
export const PROOF_DISTANCE_FLAG_METERS = 150;

/** Whether a proof meets the handover's requirement; if not, what is missing, in words. */
export function proofSatisfies(handover: unknown, proof: DeliveryProof | null | undefined): { ok: true } | { ok: false; missing: string } {
  const need = proofRequirement(handover);
  if (need.needsName && !String(proof?.receivedBy ?? "").trim()) return { ok: false, missing: "who received it" };
  if (need.needsPhoto && !proof?.photoUrl && !proof?.photoPending) return { ok: false, missing: "a photo of where it was left" };
  return { ok: true };
}

/** A delivery is not finished until its handover is proven the way it was asked for. */
export function proofComplete(proof: DeliveryProof | null | undefined, handover: unknown = DEFAULT_HANDOVER): boolean {
  return !!proof?.signedAt && proofSatisfies(handover, proof).ok;
}

/** What the desk reads on the job row. */
export function describeProof(proof: DeliveryProof | null | undefined, handover: unknown = DEFAULT_HANDOVER): string | null {
  if (!proof?.signedAt) return null;
  const parts: string[] = [];
  if (proof.receivedBy) parts.push(`received by ${proof.receivedBy}`);
  else if (handoverOf(handover) === "unattended") parts.push("left at the door");
  if (proof.photoUrl) parts.push("photo");
  else if (proof.photoPending) parts.push("photo pending");
  else if (proof.photoNeverArrived) parts.push("photo never arrived");
  else if (proof.photoRetired) parts.push("photo kept 90 days, now retired");
  if (proof.farFromDrop) parts.push("recorded away from the drop address");
  return parts.join(" · ");
}
