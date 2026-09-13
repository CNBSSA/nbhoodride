import { describe, expect, it } from "vitest";
import {
  MINIMUM_PAYDAY_AMOUNT, paydayFor, paydayKeyOf, paydayLabel, paydayRunDue,
} from "./paydayCycle";

// Eastern time. 2026-09-11 is a Friday.
const et = (iso: string) => new Date(iso);

describe("when payday falls", () => {
  it("is Friday morning Eastern, not before", () => {
    expect(paydayRunDue(et("2026-09-11T12:00:00Z"))).toBe(false); // Fri 08:00 ET
    expect(paydayRunDue(et("2026-09-11T13:00:00Z"))).toBe(true);  // Fri 09:00 ET
    expect(paydayRunDue(et("2026-09-11T23:00:00Z"))).toBe(true);  // Fri 19:00 ET
  });

  it("does not fire on any other day", () => {
    for (const d of ["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-12", "2026-09-13"]) {
      expect(paydayRunDue(et(`${d}T18:00:00Z`))).toBe(false);
    }
  });

  it("names the payday by its Friday, so a run is claimed once", () => {
    expect(paydayKeyOf(et("2026-09-11T13:00:00Z"))).toBe("2026-09-11"); // on the day
    expect(paydayKeyOf(et("2026-09-13T18:00:00Z"))).toBe("2026-09-11"); // Sunday after
    expect(paydayKeyOf(et("2026-09-10T18:00:00Z"))).toBe("2026-09-04"); // Thursday before
  });

  it("reads as a date a driver would recognise", () => {
    expect(paydayLabel("2026-09-11")).toBe("Fri 11 Sep");
  });
});

describe("what a driver is paid", () => {
  it("pays the whole balance when there is somewhere to send it", () => {
    expect(paydayFor(124.5, true)).toMatchObject({ amount: 124.5, pay: true });
  });

  it("pays nobody who has not said where to send it", () => {
    const d = paydayFor(200, false);
    expect(d.pay).toBe(false);
    expect(d.amount).toBe(0);
    expect(d.reason).toMatch(/payout method/i);
  });

  it("carries a small balance to next Friday instead of making a tiny payment", () => {
    const d = paydayFor(MINIMUM_PAYDAY_AMOUNT - 0.01, true);
    expect(d.pay).toBe(false);
    expect(d.reason).toMatch(/next Friday/);
    expect(paydayFor(MINIMUM_PAYDAY_AMOUNT, true).pay).toBe(true);
  });

  it("never pays out of an empty or broken balance", () => {
    for (const bad of [0, -20, null, undefined, "", "abc"]) {
      expect(paydayFor(bad as any, true).pay).toBe(false);
      expect(paydayFor(bad as any, true).amount).toBe(0);
    }
  });

  it("rounds to the cent, so no fraction of a cent is ever sent", () => {
    expect(paydayFor(10.005, true).amount).toBe(10.01);
    expect(paydayFor("33.333", true).amount).toBe(33.33);
  });
});
