import { describe, it, expect } from "vitest";
import {
  approvalProblems, canManageFleet, canManageFleetMoney, canSeeFleetDesk, checkFleetApplication, fleetSplit, maskEin, normalizeEin,
} from "./fleet";
import { isOrgRole, isCategory, isOrganizationCategory, rolesForCategory, categoryMayBook } from "./commercial";

describe("fleet is a fourth kind of organization that never books", () => {
  it("is an organization category but not a booking one", () => {
    expect(isOrganizationCategory("fleet")).toBe(true);
    expect(isCategory("fleet")).toBe(false);
    expect(categoryMayBook("fleet", "ride")).toBe(false);
    expect(categoryMayBook("fleet", "delivery")).toBe(false);
    expect(isOrganizationCategory("space")).toBe(false);
  });
  it("has its own roles, and booking accounts keep theirs", () => {
    expect(rolesForCategory("fleet")).toEqual(["owner", "manager", "viewer", "driver"]);
    expect(rolesForCategory("medical")).toEqual(["owner", "requester", "billing"]);
    expect(isOrgRole("manager")).toBe(true);
    expect(isOrgRole("admin")).toBe(false);
  });
  it("owner does everything, a manager runs cars and drivers, a viewer looks, a driver drives", () => {
    expect([canSeeFleetDesk("owner"), canManageFleet("owner"), canManageFleetMoney("owner")]).toEqual([true, true, true]);
    expect([canSeeFleetDesk("manager"), canManageFleet("manager"), canManageFleetMoney("manager")]).toEqual([true, true, false]);
    expect([canSeeFleetDesk("viewer"), canManageFleet("viewer"), canManageFleetMoney("viewer")]).toEqual([true, false, false]);
    expect([canSeeFleetDesk("driver"), canManageFleet("driver"), canManageFleetMoney("driver")]).toEqual([false, false, false]);
  });
});

describe("the application", () => {
  const good = { name: "Bowie Motors", legalName: "Bowie Motors LLC", ein: "12 3456789", businessType: "llc", contactPhone: "(240) 555-0100" };
  it("takes a complete one, normalized", () => {
    const r = checkFleetApplication(good);
    expect(r.ok && r.value).toEqual({ name: "Bowie Motors", legalName: "Bowie Motors LLC", ein: "12-3456789", businessType: "llc", contactPhone: "2405550100" });
  });
  it("names every problem at once", () => {
    const r = checkFleetApplication({ name: "", ein: "123", businessType: "cult", contactPhone: "12" });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.problems).toHaveLength(5);
  });
  it("an EIN is nine digits; the desk sees only its last four", () => {
    expect(normalizeEin("123456789")).toBe("12-3456789");
    expect(normalizeEin("000000000")).toBeNull();
    expect(normalizeEin("12-345678")).toBeNull();
    expect(maskEin("12-3456789")).toBe("XX-XXX6789");
  });
  it("PG Ride approves only a waiting application with its business details and a payout method", () => {
    const app = { status: "pending", payoutMethod: "zelle", payoutDetails: "pay@bowie.example", fleetDetails: { legalName: "Bowie Motors LLC", ein: "12-3456789" } };
    expect(approvalProblems(app)).toEqual([]);
    expect(approvalProblems({ ...app, payoutMethod: null }).join(" ")).toMatch(/how it is paid/);
    expect(approvalProblems({ ...app, status: "active" }).join(" ")).toMatch(/only an application waiting/);
  });
});

describe("the split: 25/75 of the driver's 85%", () => {
  it("a $20 fare: driver's share $17.00 is $4.25 to the fleet and $12.75 to the driver", () => {
    expect(fleetSplit(17)).toEqual({ fleetShare: 4.25, driverKeeps: 12.75 });
  });
  it("rounds the fleet's part to the cent; the two always add up", () => {
    for (const share of [0.01, 0.03, 9.99, 12.34, 85.55]) {
      const s = fleetSplit(share);
      expect(Math.round((s.fleetShare + s.driverKeeps) * 100)).toBe(Math.round(share * 100));
    }
    expect(fleetSplit(10.01)).toEqual({ fleetShare: 2.5, driverKeeps: 7.51 });
    expect(fleetSplit("bad")).toEqual({ fleetShare: 0, driverKeeps: 0 });
  });
});

import { fleetCarProblems, FLEET_CAR_REVIEWED_FIELDS } from "./fleet";

describe("a fleet's cars are checked like any car on PG Ride", () => {
  const now = new Date("2026-09-28T12:00:00Z");
  const inAYear = new Date("2027-09-28T00:00:00Z");
  const good = {
    year: 2022, seats: 5, licensePlate: "3AB1234", vin: "1HGCM82633A004352", photos: ["/a", "/b", "/c", "/d"],
    registrationDocUrl: "/r", insuranceDocUrl: "/i", inspectionDocUrl: "/n",
    inspectionExpires: inAYear, registrationExpires: inAYear, insuranceExpires: inAYear, reviewStatus: "approved",
  };
  it("a complete, checked, current car is ready", () => {
    expect(fleetCarProblems(good, now)).toEqual([]);
  });
  it("names every gap, and waits for PG Ride's check", () => {
    const p = fleetCarProblems({ ...good, year: 2010, seats: 12, vin: "SHORT", photos: ["/a"], insuranceDocUrl: null, inspectionExpires: new Date("2026-01-01"), reviewStatus: "pending" }, now);
    expect(p.join(" | ")).toMatch(/more than 12 model years/);
    expect(p.join(" | ")).toMatch(/more than 8/);
    expect(p.join(" | ")).toMatch(/VIN/);
    expect(p.join(" | ")).toMatch(/4 photos/);
    expect(p.join(" | ")).toMatch(/insurance card/);
    expect(p.join(" | ")).toMatch(/inspection is missing or expired/);
    expect(p.join(" | ")).toMatch(/has not checked the papers yet/);
  });
  it("a sent-back car says so; a lapsed paper alone parks a checked car", () => {
    expect(fleetCarProblems({ ...good, reviewStatus: "rejected" }, now).join(" ")).toMatch(/could not accept the papers/);
    expect(fleetCarProblems({ ...good, insuranceExpires: new Date("2026-09-28T11:59:00Z") }, now)).toEqual(["Insurance is missing or expired."]);
  });
  it("what the car IS is checked again; a colour or a photo is not", () => {
    expect(FLEET_CAR_REVIEWED_FIELDS).toContain("vin");
    expect(FLEET_CAR_REVIEWED_FIELDS).not.toContain("color");
    expect(FLEET_CAR_REVIEWED_FIELDS).not.toContain("photos");
  });
});
