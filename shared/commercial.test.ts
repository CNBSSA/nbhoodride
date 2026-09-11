import { describe, expect, it } from "vitest";
import {
  DEFAULT_FACILITY_FEE,
  canBook,
  canManageMembers,
  canSeeStatement,
  commercialPagingFields,
  currentMonthKey,
  formatJobNumber,
  jobTotal,
  statementCsv,
  statementMonthWindow,
  statementTotals,
  type StatementLine,
} from "./commercial";

describe("roles", () => {
  it("owners and requesters book; owners and billing see money; only owners manage people", () => {
    expect(canBook("owner")).toBe(true);
    expect(canBook("requester")).toBe(true);
    expect(canBook("billing")).toBe(false);
    expect(canSeeStatement("billing")).toBe(true);
    expect(canSeeStatement("requester")).toBe(false);
    expect(canManageMembers("owner")).toBe(true);
    expect(canManageMembers("requester")).toBe(false);
    expect(canBook(null)).toBe(false);
  });
});

describe("job totals", () => {
  it("a completed job is fare plus facility fee plus waiting; a cancelled one is only its cancellation fee", () => {
    expect(jobTotal("completed", { fare: "30.00", facilityFee: 4, waitFee: "2.50" })).toBe(36.5);
    expect(jobTotal("cancelled", { fare: "30.00", facilityFee: 4, cancellationFee: "7.00" })).toBe(7);
    expect(jobTotal("pending", { fare: "30.00", facilityFee: 4 })).toBe(0);
  });
  it("medical carries the four-dollar facility fee by default; deliveries carry none", () => {
    expect(DEFAULT_FACILITY_FEE.medical).toBe(4);
    expect(DEFAULT_FACILITY_FEE.business).toBe(0);
    expect(DEFAULT_FACILITY_FEE.food).toBe(0);
  });
});

const lines: StatementLine[] = [
  { jobNumber: 1, at: "2026-09-02T10:10:00.000Z", passenger: "Ada L.", from: "Bowie, MD", to: "Largo, MD", status: "completed", fare: "30.00", facilityFee: "4.00", waitFee: "0.00" },
  { jobNumber: 2, at: "2026-09-04T10:10:00.000Z", passenger: "Ada L.", from: "Bowie, MD", to: "Largo, MD", status: "completed", fare: "30.00", facilityFee: "4.00", waitFee: "2.50" },
  { jobNumber: 3, at: "2026-09-06T10:10:00.000Z", passenger: "Sam D.", from: "Upper Marlboro, MD", to: "Largo, MD", status: "cancelled", fare: "22.00", facilityFee: "4.00", cancellationFee: "7.00" },
  { jobNumber: 4, at: "2026-09-08T10:10:00.000Z", passenger: "Sam D.", from: "Upper Marlboro, MD", to: "Largo, MD", status: "pending", fare: "22.00", facilityFee: "4.00" },
];

describe("statement", () => {
  it("sums fares, fees and cancellations, and ignores jobs not yet done", () => {
    const t = statementTotals(lines);
    expect(t).toEqual({ jobs: 4, completed: 2, cancelled: 1, fares: 60, facilityFees: 8, waitFees: 2.5, cancellationFees: 7, total: 77.5 });
  });
  it("renders CSV with a header, a line per job, and a totals line, quoting commas", () => {
    const w = statementMonthWindow("2026-09");
    const csv = statementCsv("Largo Dialysis, LLC", w, lines);
    const rows = csv.trim().split("\n");
    expect(rows[0]).toBe("Job,Date,Passenger,From,To,Status,Received by,Fare,Facility fee,Waiting,Cancellation fee,Total");
    expect(rows[1]).toContain("J-00001,2026-09-02T10:10:00.000Z,Ada L.,\"Bowie, MD\",\"Largo, MD\",completed,,30.00,4.00,0.00,0.00,34.00");
    expect(rows[3]).toContain("cancelled,,0.00,0.00,0.00,7.00,7.00");
    expect(rows[5]).toBe('Total,September 2026,"Largo Dialysis, LLC",,,"2 completed, 1 cancelled",,60.00,8.00,2.50,7.00,77.50');
  });
  it("a passenger name that looks like a formula cannot run in a spreadsheet", () => {
    const w = statementMonthWindow("2026-09");
    const csv = statementCsv("Org", w, [{ ...lines[0], passenger: "=HYPERLINK(\"http://x\")", from: "+1 Main St", to: "-Largo" }]);
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("'+1 Main St");
    expect(csv).toContain("'-Largo");
    expect(csv).toContain(",30.00,4.00,0.00,0.00,34.00");
  });
  it("the month window is the Eastern calendar month, December included", () => {
    const sep = statementMonthWindow("2026-09");
    expect(sep.label).toBe("September 2026");
    expect(sep.start.toISOString()).toBe("2026-09-01T04:00:00.000Z");
    expect(sep.end.toISOString()).toBe("2026-10-01T04:00:00.000Z");
    const dec = statementMonthWindow("2026-12");
    expect(dec.end.toISOString()).toBe("2027-01-01T05:00:00.000Z");
    expect(() => statementMonthWindow("2026-13")).toThrow();
    expect(currentMonthKey(new Date("2026-09-30T23:30:00-04:00"))).toBe("2026-09");
    expect(currentMonthKey(new Date("2026-10-01T00:30:00-04:00"))).toBe("2026-10");
  });
});

describe("paging", () => {
  it("names the account and the job, never the passenger", () => {
    const f = commercialPagingFields({ orgName: "Largo Dialysis", jobNumber: 42, category: "medical" });
    expect(f).toEqual([["Account", "Largo Dialysis"], ["Job", "J-00042"], ["Work", "Medical transportation"]]);
    expect(JSON.stringify(f)).not.toMatch(/phone|passenger/i);
  });
  it("job numbers read the same on paper and on the phone", () => {
    expect(formatJobNumber(7)).toBe("J-00007");
    expect(formatJobNumber("123456")).toBe("J-123456");
  });
});
