import { describe, expect, it } from "vitest";
import { inventory, judge } from "./shipped-buttons.mjs";

describe("nothing built is removed: the shipped-button rule", () => {
  const register = {
    shipped: ["button-book-ride", "button-complete-ride-*", "button-old-thing"],
    retired: { "button-old-thing": { reason: "replaced by the new booking sheet", approvedBy: "Festus", date: "2026-09-16" } },
  };

  it("finds static ids and templated prefixes in source", () => {
    const src = `<button data-testid="button-book-ride" /> <b data-testid={\`button-complete-ride-\${ride.id}\`} /> <i data-testid={"button-quoted"} />`;
    expect(inventory(src)).toEqual(["button-book-ride", "button-complete-ride-*", "button-quoted"]);
  });

  it("passes when every shipped button is still there", () => {
    const v = judge(["button-book-ride", "button-complete-ride-*"], register);
    expect(v.removed).toEqual([]);
    expect(v.unregistered).toEqual([]);
  });

  it("fails when a shipped button is gone without an approved retirement", () => {
    const v = judge(["button-complete-ride-*"], register);
    expect(v.removed).toEqual(["button-book-ride"]);
  });

  it("does not fail for a button retired with reason, approver and date", () => {
    expect(judge(["button-book-ride", "button-complete-ride-*"], register).removed).not.toContain("button-old-thing");
  });

  it("rejects a retirement missing its reason or approver", () => {
    const v = judge(["button-book-ride", "button-complete-ride-*"], { ...register, retired: { "button-old-thing": { reason: "", approvedBy: "", date: "2026-09-16" } } });
    expect(v.badRetirements).toEqual(["button-old-thing"]);
  });

  it("asks for new buttons to be registered, so the register stays complete", () => {
    const v = judge(["button-book-ride", "button-complete-ride-*", "button-send-parcel"], register);
    expect(v.unregistered).toEqual(["button-send-parcel"]);
  });

  it("notices a retired button that came back", () => {
    const v = judge(["button-book-ride", "button-complete-ride-*", "button-old-thing"], register);
    expect(v.returned).toEqual(["button-old-thing"]);
  });
});
