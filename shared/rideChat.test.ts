import { describe, expect, it } from "vitest";
import {
  buildRideMessageWsPayload,
  isRideChatActiveStatus,
  validateRideChatBody,
} from "./rideChat";

describe("validateRideChatBody", () => {
  it("accepts trimmed text", () => {
    const result = validateRideChatBody("  On my way  ");
    expect(result).toEqual({ ok: true, body: "On my way" });
  });

  it("rejects empty", () => {
    expect(validateRideChatBody("   ").ok).toBe(false);
  });

  it("rejects phone numbers", () => {
    expect(validateRideChatBody("Call me at 301-555-1234").ok).toBe(false);
  });

  it("rejects email addresses", () => {
    expect(validateRideChatBody("email me at rider@example.com").ok).toBe(false);
  });
});

describe("isRideChatActiveStatus", () => {
  it("allows active ride statuses", () => {
    expect(isRideChatActiveStatus("in_progress")).toBe(true);
  });

  it("blocks completed", () => {
    expect(isRideChatActiveStatus("completed")).toBe(false);
  });
});

describe("buildRideMessageWsPayload", () => {
  it("includes ride_message type and text alias", () => {
    const payload = buildRideMessageWsPayload({
      id: "m1",
      rideId: "r1",
      senderId: "u1",
      senderRole: "rider",
      kind: "text",
      messageKey: null,
      body: "Hello",
      createdAt: "2026-07-01T12:00:00.000Z",
    });
    expect(payload.type).toBe("ride_message");
    expect(payload.text).toBe("Hello");
  });
});
