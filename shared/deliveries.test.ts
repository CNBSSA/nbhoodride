import { describe, expect, it } from "vitest";
import {
  DELIVERY_RATES, MIN_LEAD_MINUTES, SIZE_VEHICLE_HINT, deliveryFare, describeDeliveryTariff,
  describeParcel, describeWindow, isParcelSize, proofComplete, validateDelivery,
} from "./deliveries";

const now = new Date("2026-09-10T14:00:00Z");
const readyIn = (mins: number) => new Date(now.getTime() + mins * 60_000).toISOString();
const ok = { parcelSize: "small", pickupContact: { name: "Front desk" }, dropContact: { name: "Ms Rivera" }, readyAt: readyIn(90) };

describe("what a delivery costs", () => {
  it("a flat fare covers the first few miles, then a rate per mile", () => {
    expect(deliveryFare(0)).toBe(9);
    expect(deliveryFare(3)).toBe(9);
    expect(deliveryFare(4)).toBe(10.6);
    expect(deliveryFare(10)).toBe(20.2);
  });
  it("nonsense distance falls back to the base fare, never below it", () => {
    expect(deliveryFare(NaN)).toBe(DELIVERY_RATES.baseFare);
    expect(deliveryFare(-5)).toBe(DELIVERY_RATES.baseFare);
  });
  it("the tariff reads as a sentence", () => {
    expect(describeDeliveryTariff()).toBe("$9.00 covers the first 3 miles, then $1.60 a mile.");
  });
});

describe("what is being sent", () => {
  it("only the four sizes", () => {
    expect(isParcelSize("envelope")).toBe(true);
    expect(isParcelSize("pallet")).toBe(false);
    expect(isParcelSize(null)).toBe(false);
  });
  it("a large parcel is quoted for a bigger vehicle", () => {
    expect(SIZE_VEHICLE_HINT.large).toBe("xl");
    expect(SIZE_VEHICLE_HINT.medium).toBe("standard");
  });
  it("the driver's line says what it is and who takes it", () => {
    expect(describeParcel("envelope", "Ms Rivera")).toBe("Envelope or documents · hand to Ms Rivera");
    expect(describeParcel("nonsense")).toBe("Parcel");
  });
});

describe("the window", () => {
  it("runs from ready for the hours asked, two by default", () => {
    const r = validateDelivery(ok as any, now);
    expect(r.valid).toBe(true);
    if (!r.valid) return;
    expect(r.window.hours).toBe(2);
    expect(r.window.end.getTime() - r.window.start.getTime()).toBe(2 * 3_600_000);
  });
  it("reads as a sentence in Eastern time", () => {
    expect(describeWindow({ start: "2026-09-10T18:00:00Z", end: "2026-09-10T20:00:00Z" }))
      .toBe("Ready 2:00 PM, deliver by 4:00 PM");
  });
  it("refuses what it cannot dispatch", () => {
    const soon = validateDelivery({ ...ok, readyAt: readyIn(10) } as any, now);
    expect(soon.valid).toBe(false);
    if (!soon.valid) expect(soon.error).toContain(String(MIN_LEAD_MINUTES));
    expect(validateDelivery({ ...ok, windowHours: 0 } as any, now).valid).toBe(false);
    expect(validateDelivery({ ...ok, windowHours: 24 } as any, now).valid).toBe(false);
    expect(validateDelivery({ ...ok, readyAt: "not a time" } as any, now).valid).toBe(false);
  });
  it("needs both ends of the handover named", () => {
    const noDrop = validateDelivery({ ...ok, dropContact: { name: "  " } } as any, now);
    expect(noDrop.valid).toBe(false);
    if (!noDrop.valid) expect(noDrop.error).toContain("Who receives it");
    const noPickup = validateDelivery({ ...ok, pickupContact: { name: "" } } as any, now);
    if (!noPickup.valid) expect(noPickup.error).toContain("hands the parcel over");
    const noSize = validateDelivery({ ...ok, parcelSize: "pallet" } as any, now);
    if (!noSize.valid) expect(noSize.error).toContain("envelope");
  });
});

describe("proof", () => {
  it("is not complete until someone is named and it is stamped", () => {
    expect(proofComplete(null)).toBe(false);
    expect(proofComplete({ receivedBy: "Ms Rivera" })).toBe(false);
    expect(proofComplete({ receivedBy: "Ms Rivera", signedAt: now.toISOString() })).toBe(true);
  });
});

import { describeHandover, describeProof, handoverOf, proofComplete as proofCompleteRule, proofRequirement, proofSatisfies } from "./deliveries";

describe("how a parcel changes hands decides the proof (Festus: a photo only when nobody signs)", () => {
  it("defaults to handing it to the named person", () => {
    expect(handoverOf(undefined)).toBe("person");
    expect(handoverOf("pigeon")).toBe("person");
    expect(handoverOf("unattended")).toBe("unattended");
  });
  it("a person or reception signs; the door gets a photo", () => {
    expect(proofRequirement("person")).toEqual({ needsName: true, needsPhoto: false });
    expect(proofRequirement("reception")).toEqual({ needsName: true, needsPhoto: false });
    expect(proofRequirement("unattended")).toEqual({ needsName: false, needsPhoto: true });
  });
  it("says what is missing, in words", () => {
    expect(proofSatisfies("person", { photoUrl: "/api/objects/db-upload/x" })).toEqual({ ok: false, missing: "who received it" });
    expect(proofSatisfies("unattended", { receivedBy: "nobody" })).toEqual({ ok: false, missing: "a photo of where it was left" });
    expect(proofSatisfies("unattended", { photoUrl: "/api/objects/db-upload/x" }).ok).toBe(true);
    expect(proofSatisfies("person", { receivedBy: "Ms Rivera" }).ok).toBe(true);
  });
  it("a photo still on the phone counts at the door, so no signal does not strand the driver", () => {
    expect(proofSatisfies("unattended", { photoPending: true }).ok).toBe(true);
    expect(proofCompleteRule({ photoPending: true, signedAt: "2026-09-17T12:00:00Z" }, "unattended")).toBe(true);
    expect(proofCompleteRule({ receivedBy: "x" }, "person")).toBe(false);
  });
  it("tells the driver what to do in one line", () => {
    expect(describeHandover("person", "Ms Rivera")).toMatch(/Hand it to Ms Rivera/);
    expect(describeHandover("unattended")).toMatch(/take a photo/);
  });
  it("tells the desk what happened, including a far-away flag", () => {
    expect(describeProof({ receivedBy: "Ms Rivera", signedAt: "x" })).toBe("received by Ms Rivera");
    expect(describeProof({ photoUrl: "/p", signedAt: "x", farFromDrop: true }, "unattended")).toBe("left at the door · photo · recorded away from the drop address");
    expect(describeProof({ photoPending: true, signedAt: "x" }, "unattended")).toBe("left at the door · photo pending");
    expect(describeProof(null)).toBeNull();
  });
});
