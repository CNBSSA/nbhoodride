import { describe, it, expect } from "vitest";
import { bookingRefusal, checkOrgApplication, orgApprovalProblems } from "./orgApplication";

describe("a booking account applies for itself", () => {
  const good = { name: "Largo Dialysis", category: "medical", legalName: "Largo Dialysis Center LLC", ein: "12 3456789", businessType: "llc", contactPhone: "(240) 555-0100", address: "1 Main St, Largo, MD" };
  it("takes a complete application, normalized", () => {
    const r = checkOrgApplication(good);
    expect(r.ok && r.value).toEqual({ name: "Largo Dialysis", category: "medical", legalName: "Largo Dialysis Center LLC", ein: "12-3456789", businessType: "llc", contactPhone: "2405550100", address: "1 Main St, Largo, MD" });
  });
  it("names every problem at once, and a fleet is not a booking account", () => {
    const r = checkOrgApplication({ name: "", category: "fleet", ein: "12", businessType: "x", contactPhone: "1" });
    expect(!r.ok && r.problems).toHaveLength(6);
  });
  it("PG Ride approves only a waiting application with its legal details", () => {
    const app = { status: "pending", category: "business", businessDetails: { legalName: "X LLC", ein: "12-3456789" } };
    expect(orgApprovalProblems(app)).toEqual([]);
    expect(orgApprovalProblems({ ...app, status: "active" }).join(" ")).toMatch(/only an application waiting/);
    expect(orgApprovalProblems({ ...app, category: "fleet" }).join(" ")).toMatch(/not a booking account/);
    expect(orgApprovalProblems({ ...app, businessDetails: null }).join(" ")).toMatch(/legal name or EIN/);
  });
  it("a refusal says which state the account is in", () => {
    expect(bookingRefusal("pending")).toMatch(/not approved/);
    expect(bookingRefusal("rejected")).toMatch(/sent back/);
    expect(bookingRefusal("paused")).toMatch(/paused/);
  });
});
