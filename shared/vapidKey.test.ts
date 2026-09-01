import { describe, expect, it } from "vitest";
import { checkVapidPublicKey, decodeBase64Url, VAPID_PUBLIC_KEY_BYTES } from "./vapidKey";

// Throwaway pair generated for this test only — never used by any environment.
const VALID_PUBLIC = "BA522LY1V5_1SoKZHi0RCOMUbIaG0n3RwLUX4YD0cshRqWtj-JZa13WZpPfqCSFyo5G6yiokF6FiqJiFuew7DH4";
const MATCHING_PRIVATE = "W_FPh-AKzeVsAJbbdRO1R89whu8TS6EaIsQtAJXqung";

describe("decodeBase64Url", () => {
  it("decodes base64url without padding", () => {
    expect(Array.from(decodeBase64Url("aGk")!)).toEqual([104, 105]); // "hi"
  });

  it("accepts standard base64 and padding too", () => {
    expect(Array.from(decodeBase64Url("aGk=")!)).toEqual([104, 105]);
  });

  it("rejects non-base64 characters", () => {
    expect(decodeBase64Url("not a key!")).toBeNull();
  });

  it("rejects an empty string", () => {
    expect(decodeBase64Url("   ")).toBeNull();
  });
});

describe("checkVapidPublicKey", () => {
  it("accepts a real VAPID public key", () => {
    const res = checkVapidPublicKey(VALID_PUBLIC);
    expect(res.valid).toBe(true);
    if (res.valid) {
      expect(res.bytes.length).toBe(VAPID_PUBLIC_KEY_BYTES);
      expect(res.bytes[0]).toBe(0x04);
    }
  });

  it("tolerates surrounding whitespace/newlines from a copy-paste", () => {
    expect(checkVapidPublicKey(`  ${VALID_PUBLIC}\n`).valid).toBe(true);
  });

  it("names the private-key mistake specifically", () => {
    const res = checkVapidPublicKey(MATCHING_PRIVATE);
    expect(res.valid).toBe(false);
    if (!res.valid) expect(res.error).toMatch(/PRIVATE key/);
  });

  it("flags a truncated key", () => {
    const res = checkVapidPublicKey(VALID_PUBLIC.slice(0, 40));
    expect(res.valid).toBe(false);
    if (!res.valid) expect(res.error).toMatch(/truncated|bytes/);
  });

  it("flags copied quotes", () => {
    const res = checkVapidPublicKey(`"${VALID_PUBLIC}"`);
    expect(res.valid).toBe(false);
    if (!res.valid) expect(res.error).toMatch(/quotes/);
  });

  it("reports an unset key", () => {
    expect(checkVapidPublicKey(undefined).valid).toBe(false);
    expect(checkVapidPublicKey("").valid).toBe(false);
  });

  it("rejects a 65-byte value that is not an uncompressed point", () => {
    const bad = new Uint8Array(65).fill(7);
    let bin = "";
    bad.forEach((b) => { bin += String.fromCharCode(b); });
    const b64 = Buffer.from(bin, "binary").toString("base64url");
    const res = checkVapidPublicKey(b64);
    expect(res.valid).toBe(false);
    if (!res.valid) expect(res.error).toMatch(/0x04/);
  });
});
