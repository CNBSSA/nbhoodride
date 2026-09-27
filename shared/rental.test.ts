import { describe, it, expect } from "vitest";
import { qualificationProblems, quoteRental, settleReturn, rentalsOverlap, isPlausibleVin, expiryWarnings, MAX_RENTAL_DAYS, MIN_PHOTOS } from "./rental";

const now = new Date("2026-09-27T12:00:00Z");
const inAYear = new Date("2027-09-27T00:00:00Z");
const good = {
  year: 2022, seats: 5, licensePlate: "3AB1234", vin: "1HGCM82633A004352",
  photos: ["/a", "/b", "/c", "/d"], dailyPrice: "49.00", deposit: "200.00",
  pickupLocation: { lat: 38.9, lng: -76.8, address: "PG Ride lot, Largo, MD" },
  inspectionExpires: inAYear, registrationExpires: inAYear, insuranceExpires: inAYear,
};

describe("qualificationProblems", () => {
  it("a complete, current car qualifies", () => {
    expect(qualificationProblems(good, now)).toEqual([]);
  });
  it("names every missing or failing item", () => {
    const p = qualificationProblems({ ...good, year: 2010, seats: 12, vin: "SHORT", photos: ["/a"], inspectionExpires: null, insuranceExpires: new Date("2026-01-01") }, now);
    expect(p.join(" | ")).toMatch(/more than 12 model years/);
    expect(p.join(" | ")).toMatch(/more than 8/);
    expect(p.join(" | ")).toMatch(/VIN/);
    expect(p.join(" | ")).toMatch(new RegExp(`${MIN_PHOTOS} photos`));
    expect(p.join(" | ")).toMatch(/inspection is missing or expired/);
    expect(p.join(" | ")).toMatch(/Insurance is missing or expired/);
    expect(p.join(" | ")).not.toMatch(/Registration/);
  });
  it("a document expiring right now is expired", () => {
    expect(qualificationProblems({ ...good, registrationExpires: now }, now)).toContain("Registration is missing or expired.");
  });
  it("VINs never contain I, O or Q", () => {
    expect(isPlausibleVin("1HGCM82633A004352")).toBe(true);
    expect(isPlausibleVin("1HGCM82633A00435O")).toBe(false);
    expect(isPlausibleVin("")).toBe(false);
  });
});

describe("quoteRental", () => {
  const car = { dailyPrice: "49", deposit: "200", milesPerDay: 150 };
  const at = (h: number) => new Date(now.getTime() + h * 3600_000).toISOString();
  it("prices whole days from the car's own prices", () => {
    const q = quoteRental(car, at(24), at(24 + 50), now);
    expect(q.ok && q.quote).toMatchObject({ days: 3, rentalTotal: 147, deposit: 200, milesAllowed: 450, dailyPrice: 49 });
  });
  it("part of a day is a day, and a short rental is one day", () => {
    const q = quoteRental(car, at(2), at(5), now);
    expect(q.ok && q.quote.days).toBe(1);
  });
  it("refuses a rental longer than the limit, in the past, too soon, too far ahead or backwards", () => {
    expect(quoteRental(car, at(2), at(2 + 24 * MAX_RENTAL_DAYS + 1), now).ok).toBe(false);
    expect(quoteRental(car, at(2), at(2 + 24 * MAX_RENTAL_DAYS), now).ok).toBe(true);
    expect(quoteRental(car, at(-3), at(10), now).ok).toBe(false);
    expect(quoteRental(car, at(0.5), at(10), now).ok).toBe(false);
    expect(quoteRental(car, at(24 * 91), at(24 * 92), now).ok).toBe(false);
    expect(quoteRental(car, at(10), at(5), now).ok).toBe(false);
    expect(quoteRental(car, "nonsense", at(5), now).ok).toBe(false);
  });
  it("a car with no price cannot be quoted", () => {
    expect(quoteRental({ dailyPrice: null, deposit: 0, milesPerDay: 0 }, at(2), at(5), now).ok).toBe(false);
  });
});

describe("rentalsOverlap", () => {
  it("overlapping stays clash; back to back do not", () => {
    const a = { startsAt: "2026-10-01T10:00:00Z", endsAt: "2026-10-03T10:00:00Z" };
    expect(rentalsOverlap(a, { startsAt: "2026-10-02T10:00:00Z", endsAt: "2026-10-04T10:00:00Z" })).toBe(true);
    expect(rentalsOverlap(a, { startsAt: "2026-10-03T10:00:00Z", endsAt: "2026-10-04T10:00:00Z" })).toBe(false);
    expect(rentalsOverlap(a, { startsAt: "2026-09-29T10:00:00Z", endsAt: "2026-10-05T10:00:00Z" })).toBe(true);
  });
});

describe("settleReturn", () => {
  const base = { milesAllowed: 300, collectOdometer: 10000, returnOdometer: 10250, extraMileFee: "0.40", endsAt: "2026-10-03T10:00:00Z", returnedAt: "2026-10-03T10:30:00Z", lateHourFee: "15", deposit: "200" };
  it("on time, within the miles, no damage: the whole deposit goes back", () => {
    const s = settleReturn(base);
    expect(s.ok && s.settlement).toMatchObject({ milesDriven: 250, extraMiles: 0, lateHours: 0, extrasTotal: 0, fromDeposit: 0, depositReleased: 200, beyondDeposit: 0 });
  });
  it("extra miles and lateness past the grace hour come out of the deposit", () => {
    const s = settleReturn({ ...base, returnOdometer: 10400, returnedAt: "2026-10-03T12:10:00Z" });
    expect(s.ok && s.settlement).toMatchObject({ extraMiles: 100, extraMilesCharge: 40, lateHours: 3, lateCharge: 45, extrasTotal: 85, fromDeposit: 85, depositReleased: 115, beyondDeposit: 0 });
  });
  it("damage beyond the deposit is owed on top", () => {
    const s = settleReturn({ ...base, damageAmount: "350" });
    expect(s.ok && s.settlement).toMatchObject({ damage: 350, fromDeposit: 200, depositReleased: 0, beyondDeposit: 150 });
  });
  it("refuses readings that go backwards and a negative damage", () => {
    expect(settleReturn({ ...base, returnOdometer: 9000 }).ok).toBe(false);
    expect(settleReturn({ ...base, damageAmount: "-5" }).ok).toBe(false);
    expect(settleReturn({ ...base, collectOdometer: NaN }).ok).toBe(false);
  });
});

describe("expiryWarnings", () => {
  it("warns 30 and 7 days before, and not otherwise", () => {
    const d = (days: number) => new Date(now.getTime() + days * 86400_000);
    expect(expiryWarnings({ inspectionExpires: d(30), registrationExpires: d(7), insuranceExpires: d(12) }, now)).toEqual([
      { document: "safety inspection", daysLeft: 30 }, { document: "registration", daysLeft: 7 },
    ]);
  });
});

import { quoteDriverAssignment, fleetDriverMayDrive, MAX_DRIVER_WEEKS } from "./rental";

describe("quoteDriverAssignment", () => {
  const car = { weeklyDriverRent: "250", ownerKind: "fleet" };
  const at = (h: number) => new Date(now.getTime() + h * 3600_000).toISOString();
  it("whole weeks from the car's weekly rent", () => {
    const q = quoteDriverAssignment(car, at(24), 3, now);
    expect(q.ok && q.quote).toMatchObject({ weeks: 3, weeklyRent: 250, total: 750 });
    expect(q.ok && q.quote.endsAt.getTime() - q.quote.startsAt.getTime()).toBe(3 * 7 * 86400_000);
  });
  it("only fleet cars, only cars with a weekly rent, only sane weeks and dates", () => {
    expect(quoteDriverAssignment({ ...car, ownerKind: "private" }, at(24), 1, now).ok).toBe(false);
    expect(quoteDriverAssignment({ weeklyDriverRent: null, ownerKind: "fleet" }, at(24), 1, now).ok).toBe(false);
    expect(quoteDriverAssignment(car, at(24), 0, now).ok).toBe(false);
    expect(quoteDriverAssignment(car, at(24), MAX_DRIVER_WEEKS + 1, now).ok).toBe(false);
    expect(quoteDriverAssignment(car, at(24), 1.5, now).ok).toBe(false);
    expect(quoteDriverAssignment(car, at(0.2), 1, now).ok).toBe(false);
  });
});

describe("fleetDriverMayDrive", () => {
  const later = new Date(now.getTime() + 86400_000), earlier = new Date(now.getTime() - 1000);
  it("a driver with a car of their own is not stopped", () => {
    expect(fleetDriverMayDrive({ ownCars: 1, fleetCars: 1, assignment: null, now }).ok).toBe(true);
  });
  it("a fleet driver drives while the car is active and paid", () => {
    expect(fleetDriverMayDrive({ ownCars: 0, fleetCars: 1, assignment: { status: "active", paidThrough: later, endsAt: later }, now }).ok).toBe(true);
  });
  it("and not when the rent has run out or the car is not theirs now", () => {
    expect(fleetDriverMayDrive({ ownCars: 0, fleetCars: 1, assignment: { status: "active", paidThrough: earlier, endsAt: later }, now })).toMatchObject({ ok: false, reason: expect.stringMatching(/rent/) });
    expect(fleetDriverMayDrive({ ownCars: 0, fleetCars: 1, assignment: { status: "active", paidThrough: null, endsAt: later }, now }).ok).toBe(false);
    expect(fleetDriverMayDrive({ ownCars: 0, fleetCars: 1, assignment: null, now }).ok).toBe(false);
  });
});
