import { describe, expect, it } from "vitest";
import { currentTaxYear, parseTaxYear, reportingThreshold, taxYearWindow, thresholdStatus, ytdCsv } from "./taxReporting";

describe("year-to-date payouts (issue #33)", () => {
  it("uses $600 through 2025 and $2,000 from 2026", () => {
    expect(reportingThreshold(2025)).toBe(600);
    expect(reportingThreshold(2026)).toBe(2000);
  });

  it("runs a tax year from midnight Eastern on 1 January", () => {
    const { from, to } = taxYearWindow(2026);
    expect(from.toISOString()).toBe("2026-01-01T05:00:00.000Z");
    expect(to.toISOString()).toBe("2027-01-01T05:00:00.000Z");
  });

  it("knows the year in Eastern time, not UTC", () => {
    // 03:00 UTC on 1 January is still New Year's Eve in Maryland.
    expect(currentTaxYear(new Date("2027-01-01T03:00:00Z"))).toBe(2026);
    expect(currentTaxYear(new Date("2027-01-01T06:00:00Z"))).toBe(2027);
  });

  it("takes a year from 2024 to this one, and this one when none is asked", () => {
    const now = new Date("2026-10-05T12:00:00Z");
    expect(parseTaxYear(undefined, now)).toBe(2026);
    expect(parseTaxYear("2025", now)).toBe(2025);
    expect(parseTaxYear("2023", now)).toBeNull();
    expect(parseTaxYear("2027", now)).toBeNull();
    expect(parseTaxYear("20x6", now)).toBeNull();
  });

  it("says who is over, near and under the threshold", () => {
    expect(thresholdStatus(2000, 0, 2000)).toBe("over");
    expect(thresholdStatus(1500, 0, 2000)).toBe("near");
    expect(thresholdStatus(1200, 900, 2000)).toBe("near");
    expect(thresholdStatus(100, 0, 2000)).toBe("under");
  });

  it("writes a CSV a spreadsheet cannot run as a formula", () => {
    const csv = ytdCsv(2026, [{ name: "=HYPERLINK(\"x\")", email: "a@b.c", kind: "driver", methods: ["zelle"], paid: 12.5, pending: 0, payouts: 1, status: "under" }]);
    const [head, line] = csv.trim().split("\n");
    expect(head.startsWith("Year,Payee")).toBe(true);
    expect(line).toContain(`"'=HYPERLINK(""x"")"`);
    expect(line).toContain("12.50");
  });
});
