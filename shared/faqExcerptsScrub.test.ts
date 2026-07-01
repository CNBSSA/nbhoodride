/**
 * Pins the expanded PII scrubber against the categories the supervisor
 * review flagged as missing from the old implementation. Each test
 * documents the inbound risk and the expected scrub token.
 *
 * If a future contributor "simplifies" the regex set and drops a class
 * of PII from the output, the test fails — that's the whole point.
 */
import { describe, it, expect } from "vitest";
import { anonymizeChatExcerpt } from "./faqExcerpts";

describe("anonymizeChatExcerpt — supervisor-review additions", () => {
  it("scrubs full street addresses (number + word + suffix)", () => {
    const out = anonymizeChatExcerpt("Pick me up at 1600 Pennsylvania Ave NW");
    expect(out).toContain("[address]");
    expect(out).not.toContain("1600 Pennsylvania");
  });

  it("scrubs addresses with various street suffixes", () => {
    for (const s of ["123 Main St", "45 Maple Drive", "10 Park Blvd", "7 Oak Circle"]) {
      expect(anonymizeChatExcerpt(s)).toContain("[address]");
    }
  });

  it("scrubs international phone numbers (+CC format)", () => {
    expect(anonymizeChatExcerpt("Call me at +44 20 7946 0958")).toContain("[phone]");
    expect(anonymizeChatExcerpt("My number is +1-202-555-0100")).toContain("[phone]");
  });

  it("still scrubs US-format phone numbers", () => {
    expect(anonymizeChatExcerpt("text me at 240-555-0123 anytime")).toContain("[phone]");
  });

  it("scrubs credit card numbers", () => {
    expect(anonymizeChatExcerpt("My card is 4111 1111 1111 1111")).toContain("[card]");
    expect(anonymizeChatExcerpt("Use 5500-0000-0000-0004")).toContain("[card]");
  });

  it("scrubs SSNs", () => {
    expect(anonymizeChatExcerpt("SSN 123-45-6789 for the W-9")).toContain("[ssn]");
  });

  it("scrubs lat/lng coordinate pairs", () => {
    expect(anonymizeChatExcerpt("Pick me up at 38.9072, -76.7716")).toContain("[coords]");
  });

  it("scrubs URLs (which often contain emails / IDs in query strings)", () => {
    expect(
      anonymizeChatExcerpt("Confirm at https://pgride.com/booking?email=festus@example.com&id=42"),
    ).toContain("[url]");
  });

  it("still scrubs emails / zips / amounts (original behavior preserved)", () => {
    expect(anonymizeChatExcerpt("ride was $25.50")).toContain("[amount]");
    expect(anonymizeChatExcerpt("zip 20774")).toContain("[zip]");
    expect(anonymizeChatExcerpt("email me at jane@example.com")).toContain("[email]");
  });

  it("collapses whitespace introduced by substitutions", () => {
    const out = anonymizeChatExcerpt("call 240-555-0123 or email j@x.com please");
    expect(out).not.toMatch(/ {2,}/);
  });

  it("returns a non-empty string for innocuous input", () => {
    const out = anonymizeChatExcerpt("how do I cancel a ride?");
    expect(out).toBe("how do I cancel a ride?");
  });
});
