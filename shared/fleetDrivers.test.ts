import { describe, it, expect } from "vitest";
import { assignProblems, driverApprovalWords, fleetCarMayDrive, otherFleetForDriver, OTHER_FLEET_FOR_DESK, ONE_FLEET_RULE } from "./fleet";

const now = new Date("2026-09-29T12:00:00Z");
const inAYear = new Date("2027-09-29T00:00:00Z");
const readyCar = {
  organizationId: "f1", status: "ready", driverUserId: null as string | null,
  year: 2022, seats: 5, licensePlate: "3AB1234", vin: "1HGCM82633A004352", photos: ["/a", "/b", "/c", "/d"],
  registrationDocUrl: "/r", insuranceDocUrl: "/i", inspectionDocUrl: "/n",
  inspectionExpires: inAYear, registrationExpires: inAYear, insuranceExpires: inAYear, reviewStatus: "approved",
};
const ok = { car: readyCar, fleetId: "f1", fleetStatus: "active", driverRole: "driver" as const, driverApproval: "approved", driverSuspended: false, driverHasCarId: null, now };

describe("giving a fleet car to a driver", () => {
  it("a ready car of the fleet goes to its own approved driver", () => {
    expect(assignProblems(ok)).toEqual([]);
  });
  it("a fleet can never approve its own drivers: a driver PG Ride has not approved is refused, and told why", () => {
    const p = assignProblems({ ...ok, driverApproval: "pending" }).join(" ");
    expect(p).toMatch(/PG Ride has not approved them as a driver/);
    expect(p).toMatch(/cannot approve its own drivers/);
    expect(assignProblems({ ...ok, driverApproval: null }).join(" ")).toMatch(/Has not applied to drive yet/);
    expect(assignProblems({ ...ok, driverSuspended: true }).join(" ")).toMatch(/suspended/);
  });
  it("only a ready car, and one that is free", () => {
    expect(assignProblems({ ...ok, car: { ...readyCar, status: "parked", reviewStatus: "pending" } }).join(" ")).toMatch(/not ready to carry riders: PG Ride has not checked the papers yet/);
    expect(assignProblems({ ...ok, car: { ...readyCar, insuranceExpires: new Date("2026-09-29T11:00:00Z") } }).join(" ")).toMatch(/Insurance is missing or expired/);
    expect(assignProblems({ ...ok, car: { ...readyCar, driverUserId: "someone" } }).join(" ")).toMatch(/already with a driver/);
  });
  it("one car per driver, the fleet's own driver, the fleet's own car, an open fleet", () => {
    expect(assignProblems({ ...ok, driverHasCarId: "c2" }).join(" ")).toMatch(/One car per driver/);
    expect(assignProblems({ ...ok, driverRole: "viewer" }).join(" ")).toMatch(/not one of this fleet's drivers/);
    expect(assignProblems({ ...ok, driverRole: null }).join(" ")).toMatch(/not one of this fleet's drivers/);
    expect(assignProblems({ ...ok, fleetId: "f2" }).join(" ")).toMatch(/not this fleet's/);
    expect(assignProblems({ ...ok, fleetStatus: "paused" }).join(" ")).toMatch(/paused/);
  });
});

describe("one fleet at a time", () => {
  it("the desk is told without naming the other fleet; the driver is told which", () => {
    expect(OTHER_FLEET_FOR_DESK).toContain(ONE_FLEET_RULE);
    expect(OTHER_FLEET_FOR_DESK).not.toMatch(/Motors/);
    expect(otherFleetForDriver("Acme Motors")).toMatch(/You already drive for Acme Motors\. A driver drives for one fleet at a time\./);
  });
  it("PG Ride's approval reads in plain words", () => {
    expect(driverApprovalWords("approved")).toBe("Approved by PG Ride");
    expect(driverApprovalWords("pending")).toMatch(/Waiting for PG Ride/);
    expect(driverApprovalWords(undefined)).toMatch(/not applied/);
  });
});

describe("a fleet car is drivable only while it is ready", () => {
  const car = { label: "2022 Toyota Camry (FLT0001)", status: "ready", parkedReason: null };
  it("a ready car with its copy may be driven", () => {
    expect(fleetCarMayDrive({ otherCars: 0, fleetCar: car, hasFleetCopy: true })).toEqual({ ok: true });
  });
  it("a parked car may not, and says why", () => {
    const v = fleetCarMayDrive({ otherCars: 0, fleetCar: { ...car, status: "parked", parkedReason: "Insurance is missing or expired." }, hasFleetCopy: false });
    expect(v.ok).toBe(false);
    expect(!v.ok && v.reason).toMatch(/FLT0001\) is parked: Insurance is missing or expired\./);
  });
  it("a driver with another car of their own is not held back by a parked fleet car", () => {
    expect(fleetCarMayDrive({ otherCars: 1, fleetCar: { ...car, status: "parked" }, hasFleetCopy: false })).toEqual({ ok: true });
  });
  it("no fleet car is not this rule's to judge", () => {
    expect(fleetCarMayDrive({ otherCars: 0, fleetCar: null, hasFleetCopy: false })).toEqual({ ok: true });
  });
});

import { fleetCarHoldProblem, fleetCarGivenNotice, fleetCarTakenBackNotice } from "./fleet";

describe("who may still hold a fleet car (slice 3, finished)", () => {
  const ok = { approvalStatus: "approved", driverSuspended: false, accountApproved: true, accountSuspended: false };
  it("an approved, active driver may", () => { expect(fleetCarHoldProblem(ok)).toBeNull(); });
  it("a revoked driver approval may not, naming the status", () => {
    expect(fleetCarHoldProblem({ ...ok, approvalStatus: "rejected" })).toMatch(/Driver approval is no longer in place/);
    expect(fleetCarHoldProblem({ ...ok, approvalStatus: "pending" })).toMatch(/Driver approval is no longer in place/);
  });
  it("a suspended driver, a suspended or unapproved account, or a closed account may not", () => {
    expect(fleetCarHoldProblem({ ...ok, driverSuspended: true })).toMatch(/Driving is suspended/);
    expect(fleetCarHoldProblem({ ...ok, accountSuspended: true })).toMatch(/account is suspended/);
    expect(fleetCarHoldProblem({ ...ok, accountApproved: false })).toMatch(/no longer approved/);
    expect(fleetCarHoldProblem({ ...ok, deleted: true })).toMatch(/closed/);
  });
  it("a missing account flag is not read as revoked", () => {
    expect(fleetCarHoldProblem({ ...ok, accountApproved: null, accountSuspended: null, driverSuspended: null })).toBeNull();
  });
});

describe("what the driver is told", () => {
  it("names the fleet, the car and the split when a car is given", () => {
    const n = fleetCarGivenNotice("Acme Fleet", "2024 Toyota Camry (ABC123)");
    expect(n.title).toContain("Acme Fleet");
    expect(n.body).toContain("2024 Toyota Camry (ABC123)");
    expect(n.body).toMatch(/75% to you and 25% to Acme Fleet/);
  });
  it("says whether they can still drive when the car goes back", () => {
    expect(fleetCarTakenBackNotice("Acme", "Car", { hasOtherCar: true }).body).toMatch(/own car/);
    expect(fleetCarTakenBackNotice("Acme", "Car", { hasOtherCar: false }).body).toMatch(/cannot go online/);
  });
  it("gives PG Ride's reason when PG Ride took it", () => {
    const n = fleetCarTakenBackNotice("Acme", "Car", { hasOtherCar: false, why: "Driving is suspended by PG Ride." });
    expect(n.body).toMatch(/^PG Ride took Car back for Acme\. Reason: Driving is suspended/);
  });
});
