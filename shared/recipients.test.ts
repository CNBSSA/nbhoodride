import { describe, expect, it } from "vitest";
import { normalizeRecipient, recipientPhoneKey } from "./recipients";

describe("the recipient book", () => {
  it("keys a person by their ten digits, however typed", () => {
    expect(recipientPhoneKey("(301) 555-0177")).toBe("3015550177");
    expect(recipientPhoneKey("+1 301 555 0177")).toBe("3015550177");
    expect(recipientPhoneKey("555-0177")).toBeNull();
    expect(recipientPhoneKey(null)).toBeNull();
  });
  it("needs a name and a real address; the phone is optional but must be real", () => {
    const addr = { lat: 38.78, lng: -77.01, address: "National Harbor, MD" };
    expect(normalizeRecipient({ name: "Tunde", address: addr }).valid).toBe(true);
    expect(normalizeRecipient({ name: "", address: addr })).toEqual({ valid: false, error: "The recipient needs a name." });
    expect(normalizeRecipient({ name: "Tunde", address: { address: "x" } }).valid).toBe(false);
    expect(normalizeRecipient({ name: "Tunde", phone: "12", address: addr }).valid).toBe(false);
    const r = normalizeRecipient({ name: " Tunde ", phone: "(301) 555-0177", address: addr, handover: "unattended", note: " side door " });
    expect(r.valid && r.recipient).toEqual({ name: "Tunde", phone: "3015550177", address: addr, handover: "unattended", note: "side door" });
  });
  it("defaults an unknown handover to handing it to the person", () => {
    const r = normalizeRecipient({ name: "A", address: { lat: 1, lng: 1, address: "x" }, handover: "pigeon" });
    expect(r.valid && r.recipient.handover).toBe("person");
  });
});
