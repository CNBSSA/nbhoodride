import { describe, it, expect } from "vitest";
import { SUPPORT_CONTACTS } from "./supportContacts";

describe("supportContacts", () => {
  it("uses Maryland-area 571 support line (not 561)", () => {
    expect(SUPPORT_CONTACTS.phoneTel).toBe("+15712458187");
  });
});
