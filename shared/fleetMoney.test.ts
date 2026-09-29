import { describe, it, expect } from "vitest";
import { fleetFeeSplit, fleetPaydayFor, fleetRideFor, fleetRideSplit, groupFleetEarnings, type FleetEarningLine } from "./fleet";
import { splitFare } from "./payoutPolicy";

const car = { id: "car1", organizationId: "f1", driverUserId: "d1" };
const fleet = { id: "f1", category: "fleet", status: "active" };
const base = { enabled: true, driverUserId: "d1", paymentMethod: "card", vehiclesInOrder: [{ fleetCarId: "car1" }], car, fleet };

describe("which rides are fleet rides", () => {
  it("a ride in the fleet car the driver has, of an open fleet, is a fleet ride", () => {
    expect(fleetRideFor(base)).toEqual({ fleetCarId: "car1", fleetOrgId: "f1" });
    expect(fleetRideFor({ ...base, paymentMethod: "invoice" })).toEqual({ fleetCarId: "car1", fleetOrgId: "f1" });
  });
  it("with fleets switched off nothing is a fleet ride", () => {
    expect(fleetRideFor({ ...base, enabled: false })).toBeNull();
  });
  it("a driver's own car comes first, so a ride in it is theirs alone", () => {
    expect(fleetRideFor({ ...base, vehiclesInOrder: [{ fleetCarId: null }, { fleetCarId: "car1" }] })).toBeNull();
  });
  it("no vehicle, a car taken back, another driver's car, or a car of another fleet is not a fleet ride", () => {
    expect(fleetRideFor({ ...base, vehiclesInOrder: [] })).toBeNull();
    expect(fleetRideFor({ ...base, car: { ...car, driverUserId: null } })).toBeNull();
    expect(fleetRideFor({ ...base, car: { ...car, driverUserId: "d2" } })).toBeNull();
    expect(fleetRideFor({ ...base, car: { ...car, id: "car2" } })).toBeNull();
    expect(fleetRideFor({ ...base, fleet: { ...fleet, id: "f2" } })).toBeNull();
    expect(fleetRideFor({ ...base, car: null })).toBeNull();
  });
  it("a paused, pending or non-fleet organization is not paid a share", () => {
    expect(fleetRideFor({ ...base, fleet: { ...fleet, status: "paused" } })).toBeNull();
    expect(fleetRideFor({ ...base, fleet: { ...fleet, status: "pending" } })).toBeNull();
    expect(fleetRideFor({ ...base, fleet: { ...fleet, category: "business" } })).toBeNull();
  });
  it("a cash ride (before cash was discontinued) is never split", () => {
    expect(fleetRideFor({ ...base, paymentMethod: "cash" })).toBeNull();
    expect(fleetRideFor({ ...base, paymentMethod: null })).toBeNull();
  });
});

describe("the split of a fleet ride", () => {
  it("the fleet takes 25% of the driver's 85% of the fare; the tip is the driver's", () => {
    const fare = splitFare(20, 5);
    const s = fleetRideSplit(fare.driverFareShare, fare.tip);
    expect(fare.driverFareShare).toBe(17);
    expect(s).toEqual({ gross: 17, fleetShare: 4.25, driverKeeps: 12.75, tip: 5, driverEarnings: 17.75 });
    // driver + fleet + PG Ride account for the fare and the tip exactly.
    expect(Math.round((s.driverEarnings + s.fleetShare + fare.platformFee) * 100)).toBe(2500);
  });
  it("odd cents: the fleet's share is rounded and the driver keeps the rest", () => {
    const fare = splitFare(23.21, 0);
    const s = fleetRideSplit(fare.driverFareShare, 0);
    expect(fare.driverFareShare).toBe(19.73);
    expect(s.fleetShare).toBe(4.93);
    expect(s.driverKeeps).toBe(14.8);
    expect(Math.round((s.fleetShare + s.driverKeeps) * 100)).toBe(1973);
  });
  it("a tip alone is never shared", () => {
    expect(fleetRideSplit(0, 3)).toEqual({ gross: 0, fleetShare: 0, driverKeeps: 0, tip: 3, driverEarnings: 3 });
  });
  it("junk is nothing", () => {
    expect(fleetRideSplit("abc", null)).toEqual({ gross: 0, fleetShare: 0, driverKeeps: 0, tip: 0, driverEarnings: 0 });
  });
});

describe("the driver's cut of a fee earned in a fleet car", () => {
  it("is shared 25/75 and adds up", () => {
    // $5 no-show fee: 80% ($4) is the driver's cut, $1 to the fleet, $3 to the driver.
    expect(fleetFeeSplit(4)).toEqual({ gross: 4, fleetShare: 1, driverKeeps: 3 });
    const odd = fleetFeeSplit(3.33);
    expect(odd.fleetShare).toBe(0.83);
    expect(Math.round((odd.fleetShare + odd.driverKeeps) * 100)).toBe(333);
  });
});

describe("what a fleet is paid on Friday", () => {
  const ok = { owed: "42.50", status: "active", payoutMethod: "zelle", payoutDetails: "fleet@example.com" };
  it("an open fleet with an account on file is paid everything owed", () => {
    expect(fleetPaydayFor(ok)).toMatchObject({ pay: true, amount: 42.5 });
  });
  it("no account on file: skipped and named", () => {
    const d = fleetPaydayFor({ ...ok, payoutDetails: null });
    expect(d.pay).toBe(false);
    expect(d.reason).toMatch(/No payout method on file/);
  });
  it("under the minimum rides to next Friday; nothing owed is nothing", () => {
    expect(fleetPaydayFor({ ...ok, owed: 4.99 })).toMatchObject({ pay: false, reason: expect.stringMatching(/next Friday/) });
    expect(fleetPaydayFor({ ...ok, owed: 0 })).toMatchObject({ pay: false, reason: "Nothing owed" });
  });
  it("a paused fleet is not paid automatically", () => {
    expect(fleetPaydayFor({ ...ok, status: "paused" })).toMatchObject({ pay: false, reason: expect.stringMatching(/paused/) });
  });
});

describe("the desk's earnings, per car and per driver", () => {
  const line = (over: Partial<FleetEarningLine>): FleetEarningLine => ({
    kind: "fare", fleetCarId: "c1", carLabel: "Camry", driverUserId: "d1", driverName: "Dayo", fare: 20, gross: 17, fleetShare: 4.25, driverKeeps: 12.75, ...over,
  });
  it("adds up rides, fares, the fleet's 25% and the drivers' 75%; a fee is not a ride", () => {
    const g = groupFleetEarnings([
      line({}),
      line({ fleetCarId: "c2", carLabel: "Accord", driverUserId: "d2", driverName: "Bola" }),
      line({ kind: "no_show_fee", fare: 0, gross: 4, fleetShare: 1, driverKeeps: 3 }),
    ]);
    expect(g.totals).toEqual({ rides: 2, fares: 40, gross: 38, fleetShare: 9.5, driversShare: 28.5 });
    expect(g.byCar.find((c) => c.fleetCarId === "c1")).toMatchObject({ rides: 1, fares: 20, fleetShare: 5.25, driversShare: 15.75 });
    expect(g.byDriver.find((d) => d.driverUserId === "d2")).toMatchObject({ rides: 1, fleetShare: 4.25, driverName: "Bola" });
    expect(g.byCar[0].fleetCarId).toBe("c1");
  });
  it("an empty week is zeros", () => {
    expect(groupFleetEarnings([])).toEqual({ totals: { rides: 0, fares: 0, gross: 0, fleetShare: 0, driversShare: 0 }, byCar: [], byDriver: [] });
  });
});
