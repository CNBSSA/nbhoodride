import { describe, expect, it } from "vitest";
import {
  classifyKeyword,
  friendRideArrivedSms,
  friendRideAssignedSms,
  friendRideCompletedSms,
  helpReplySms,
  normalizePhone,
  optOutConfirmationSms,
} from "./smsMessages";

describe("normalizePhone", () => {
  it("converts a 10-digit US number to E.164", () => {
    expect(normalizePhone("240-555-0134")).toBe("+12405550134");
    expect(normalizePhone("(240) 555 0134")).toBe("+12405550134");
  });

  it("handles a leading 1", () => {
    expect(normalizePhone("1 240 555 0134")).toBe("+12405550134");
  });

  it("passes through a plausible international number", () => {
    expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958");
  });

  it("returns null for junk or empty input", () => {
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone("call me")).toBeNull();
    expect(normalizePhone("12345")).toBeNull();
  });
});

describe("classifyKeyword", () => {
  it("recognises every carrier-mandated stop word, case/punctuation insensitive", () => {
    for (const w of ["STOP", "stop", " Stop! ", "unsubscribe", "CANCEL", "quit", "end", "stopall"]) {
      expect(classifyKeyword(w)).toBe("stop");
    }
  });

  it("recognises start and help", () => {
    expect(classifyKeyword("START")).toBe("start");
    expect(classifyKeyword("unstop")).toBe("start");
    expect(classifyKeyword("HELP")).toBe("help");
    expect(classifyKeyword("info")).toBe("help");
  });

  it("returns null for ordinary replies", () => {
    expect(classifyKeyword("where is my driver")).toBeNull();
    expect(classifyKeyword("")).toBeNull();
    expect(classifyKeyword(null)).toBeNull();
  });
});

describe("friend-ride templates", () => {
  const ctx = {
    passengerName: "Ada",
    bookerName: "Festus",
    driverName: "Sam",
    vehicle: "blue Toyota Camry",
    trackingUrl: "https://www.peoplegoverned.com/emergency/abc123",
  };

  it("names the booker, driver and vehicle, and carries the tracking link", () => {
    const msg = friendRideAssignedSms(ctx);
    expect(msg).toContain("Festus booked");
    expect(msg).toContain("Sam");
    expect(msg).toContain("blue Toyota Camry");
    expect(msg).toContain(ctx.trackingUrl);
  });

  it("degrades gracefully when details are unknown", () => {
    const msg = friendRideAssignedSms({});
    expect(msg).toContain("Someone booked");
    expect(msg).toContain("Your driver");
    expect(msg).not.toContain("undefined");
    expect(msg).not.toContain("null");
  });

  it("every outbound template brands itself and offers opt-out", () => {
    for (const msg of [
      friendRideAssignedSms(ctx),
      friendRideArrivedSms(ctx),
      friendRideCompletedSms(ctx),
    ]) {
      expect(msg).toContain("PG Ride");
      expect(msg).toContain("Reply STOP to opt out.");
    }
  });

  it("keeps messages within a sane length for carriers", () => {
    for (const msg of [friendRideAssignedSms(ctx), friendRideArrivedSms(ctx), friendRideCompletedSms(ctx)]) {
      expect(msg.length).toBeLessThanOrEqual(320);
    }
  });

  it("help reply carries support contacts and opt-out", () => {
    const msg = helpReplySms("+1 571-245-8187", "thrynovainsights@gmail.com");
    expect(msg).toContain("+1 571-245-8187");
    expect(msg).toContain("thrynovainsights@gmail.com");
    expect(msg).toContain("STOP");
  });

  it("opt-out confirmation explains how to come back", () => {
    expect(optOutConfirmationSms()).toContain("START");
  });
});
