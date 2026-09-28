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
  const base = { milesAllowed: 300, collectOdometer: 10000, returnOdometer: 10250, extraMileFee: "0.40", endsAt: "2026-10-03T10:00:00Z", returnedAt: "2026-10-03T09:59:00Z", lateHourFee: "15", deposit: "200" };
  it("no grace: a car back one minute late pays one hour", () => {
    const s = settleReturn({ ...base, returnedAt: "2026-10-03T10:01:00Z" });
    expect(s.ok && s.settlement).toMatchObject({ lateHours: 1, lateCharge: 15 });
  });
  it("on time, within the miles, no damage: the whole deposit goes back", () => {
    const s = settleReturn(base);
    expect(s.ok && s.settlement).toMatchObject({ milesDriven: 250, extraMiles: 0, lateHours: 0, extrasTotal: 0, fromDeposit: 0, depositReleased: 200, beyondDeposit: 0 });
  });
  it("extra miles and every hour late come out of the deposit", () => {
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


import { ownerSplit, RENTAL_PLATFORM_SHARE } from "./rental";

describe("private owner cars", () => {
  const privateCar = { ...good, ownerKind: "private", reviewStatus: "approved", registrationDocUrl: "/r", insuranceDocUrl: "/i", inspectionDocUrl: "/s", ownershipDocUrl: "/o" };
  it("an approved private car with its papers qualifies", () => {
    expect(qualificationProblems(privateCar, now)).toEqual([]);
  });
  it("it needs all four papers and PG Ride's check", () => {
    const p = qualificationProblems({ ...privateCar, ownershipDocUrl: null, reviewStatus: "pending" }, now).join(" | ");
    expect(p).toMatch(/proof of ownership/);
    expect(p).toMatch(/has not checked the papers/);
    expect(qualificationProblems({ ...privateCar, reviewStatus: "rejected" }, now).join(" ")).toMatch(/could not accept/);
  });
  it("a fleet car is not asked for owner papers", () => {
    expect(qualificationProblems({ ...good, ownerKind: "fleet" }, now)).toEqual([]);
  });
});

describe("ownerSplit", () => {
  it("PG Ride keeps 10% of everything collected, the owner the rest", () => {
    expect(RENTAL_PLATFORM_SHARE).toBe(0.1);
    expect(ownerSplit("135.00", { fromDeposit: 50, beyondDeposit: 16 })).toEqual({ collected: 201, platformShare: 20.1, ownerShare: 180.9 });
  });
  it("a released deposit is not revenue", () => {
    expect(ownerSplit(98, { fromDeposit: 0, beyondDeposit: 0 })).toEqual({ collected: 98, platformShare: 9.8, ownerShare: 88.2 });
    expect(ownerSplit(98, null).ownerShare).toBe(88.2);
  });
  it("shares always add up to what was collected", () => {
    for (const t of [0.01, 1.05, 33.33, 49.99, 1234.57]) {
      const s = ownerSplit(t, null);
      expect(Math.round((s.ownerShare + s.platformShare) * 100)).toBe(Math.round(s.collected * 100));
    }
  });
});


import { isOverdue, minutesOverdue } from "./rental";

describe("overdue", () => {
  it("a car is overdue the minute it is past its return time", () => {
    expect(isOverdue(new Date(now.getTime() - 60_000), now)).toBe(true);
    expect(isOverdue(new Date(now.getTime() + 60_000), now)).toBe(false);
    expect(minutesOverdue(new Date(now.getTime() - 90_000), now)).toBe(2);
    expect(minutesOverdue(new Date(now.getTime() + 90_000), now)).toBe(0);
  });
});


import {
  renterProblems, ageOn, youngRenterFee, drivingRecordCurrent, depositProblem, driverLateFee, splitFromEarnings,
  DEPOSIT_MIN, DEPOSIT_MAX,
} from "./rental";

describe("renter rules (industry practice, 2026-09-28)", () => {
  const start = new Date("2026-10-01T10:00:00Z");
  const end = new Date("2026-10-03T10:00:00Z");
  const adult = { dateOfBirth: "1990-05-01", licenceIssuedOn: "2010-06-01", licenceExpiresOn: "2030-05-01" };
  it("a 36-year-old with a 16-year licence may rent", () => {
    expect(renterProblems(adult, start, end)).toEqual([]);
  });
  it("names every missing fact", () => {
    expect(renterProblems({ dateOfBirth: "", licenceIssuedOn: null, licenceExpiresOn: "x" }, start, end)).toHaveLength(3);
  });
  it("21 on the first day, not the day before", () => {
    expect(renterProblems({ ...adult, dateOfBirth: "2005-10-01", licenceIssuedOn: "2022-01-01" }, start, end)).toEqual([]);
    expect(renterProblems({ ...adult, dateOfBirth: "2005-10-02", licenceIssuedOn: "2022-01-01" }, start, end).join(" ")).toMatch(/at least 21/);
  });
  it("under 25 needs two years of licence; 25 and over, one", () => {
    expect(renterProblems({ ...adult, dateOfBirth: "2003-01-01", licenceIssuedOn: "2025-06-01" }, start, end).join(" ")).toMatch(/Under 25.*2 years/);
    expect(renterProblems({ ...adult, dateOfBirth: "2003-01-01", licenceIssuedOn: "2024-09-30" }, start, end)).toEqual([]);
    expect(renterProblems({ ...adult, licenceIssuedOn: "2025-10-02" }, start, end).join(" ")).toMatch(/at least 1 year/);
    expect(renterProblems({ ...adult, licenceIssuedOn: "2025-10-01" }, start, end)).toEqual([]);
  });
  it("a licence has to last through the return day", () => {
    expect(renterProblems({ ...adult, licenceExpiresOn: "2026-10-03" }, start, end)).toEqual([]);
    expect(renterProblems({ ...adult, licenceExpiresOn: "2026-10-02" }, start, end).join(" ")).toMatch(/expires before/);
  });
  it("a birth date after the rental, or a licence before birth, is refused", () => {
    expect(renterProblems({ ...adult, dateOfBirth: "2030-01-01" }, start, end)).toEqual(["Check your date of birth."]);
    expect(renterProblems({ ...adult, licenceIssuedOn: "1980-01-01" }, start, end)).toEqual(["Check the date your licence was issued."]);
  });
  it("the young-renter fee is $25 a day under 25 and nothing from 25", () => {
    expect(ageOn("2002-10-02", start)).toBe(23);
    expect(youngRenterFee(24, 3)).toBe(75);
    expect(youngRenterFee(25, 3)).toBe(0);
    expect(youngRenterFee(null, 3)).toBe(0);
  });
  it("a young renter's quote carries the fee in the total", () => {
    const q = quoteRental({ dailyPrice: "40", deposit: "250", milesPerDay: 0 }, "2026-10-01T10:00:00Z", "2026-10-03T10:00:00Z", now, 22);
    expect(q.ok && q.quote.youngRenterFee).toBe(50);
    expect(q.ok && q.quote.rentalTotal).toBe(130);
  });
  it("a driving-record clearance lasts a year, and only a clearance counts", () => {
    const checked = new Date("2026-01-01T00:00:00Z");
    expect(drivingRecordCurrent({ recordStatus: "cleared", recordCheckedAt: checked }, start)).toBe(true);
    expect(drivingRecordCurrent({ recordStatus: "cleared", recordCheckedAt: checked }, new Date("2027-01-02T00:00:00Z"))).toBe(false);
    expect(drivingRecordCurrent({ recordStatus: "pending", recordCheckedAt: null }, start)).toBe(false);
    expect(drivingRecordCurrent({ recordStatus: "refused", recordCheckedAt: checked }, start)).toBe(false);
    expect(drivingRecordCurrent(null, start)).toBe(false);
  });
});

describe("deposit limits", () => {
  it("between $100 and $1,000", () => {
    expect(depositProblem(DEPOSIT_MIN)).toBeNull();
    expect(depositProblem(DEPOSIT_MAX)).toBeNull();
    expect(depositProblem(99.99)).toMatch(/between \$100\.00 and \$1000\.00/);
    expect(depositProblem(1000.01)).toMatch(/between/);
    expect(depositProblem("abc")).toMatch(/amount/);
  });
  it("a car whose deposit is out of range cannot list", () => {
    expect(qualificationProblems({ ...good, deposit: "0.00" }, now).join(" ")).toMatch(/Deposit has to be between/);
  });
});

describe("driver late fee and earnings", () => {
  it("every hour started past the end of the weeks, at the weekly rent / 168", () => {
    const ends = new Date("2026-10-01T10:00:00Z");
    expect(driverLateFee(336, ends, new Date("2026-10-01T10:00:00Z"))).toEqual({ lateHours: 0, hourlyRate: 2, lateCharge: 0 });
    expect(driverLateFee(336, ends, new Date("2026-10-01T10:01:00Z"))).toEqual({ lateHours: 1, hourlyRate: 2, lateCharge: 2 });
    expect(driverLateFee(336, ends, new Date("2026-10-01T13:30:00Z"))).toEqual({ lateHours: 4, hourlyRate: 2, lateCharge: 8 });
    expect(driverLateFee(260, ends, new Date("2026-10-01T12:00:00Z")).hourlyRate).toBe(1.55);
  });
  it("earnings first, the card for the rest", () => {
    expect(splitFromEarnings(260, 100)).toEqual({ fromEarnings: 100, fromCard: 160 });
    expect(splitFromEarnings(260, 500)).toEqual({ fromEarnings: 260, fromCard: 0 });
    expect(splitFromEarnings(260, "-5")).toEqual({ fromEarnings: 0, fromCard: 260 });
  });
  it("the young-renter fee is PG Ride's alone in a private owner's split", () => {
    // $130 collected, $50 of it the young-renter fee: the owner has 90% of $80.
    expect(ownerSplit(130, null, 50)).toEqual({ collected: 130, platformShare: 58, ownerShare: 72 });
    expect(ownerSplit(130, null)).toEqual({ collected: 130, platformShare: 13, ownerShare: 117 });
  });
});
