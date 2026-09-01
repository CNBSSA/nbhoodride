import { describe, expect, it } from "vitest";
import { cleanAssistantText } from "./assistantFormatting";

describe("cleanAssistantText", () => {
  it("strips bold markers", () => {
    expect(cleanAssistantText("**Scheduling flexibility:** yes")).toBe("Scheduling flexibility: yes");
  });

  it("converts list markers to bullets", () => {
    expect(cleanAssistantText("- **Minimum:** 3 hours\n- Maximum: 30 days")).toBe(
      "• Minimum: 3 hours\n• Maximum: 30 days",
    );
  });

  it("strips headings and inline code", () => {
    expect(cleanAssistantText("## Quick tips\nUse `Ride Now` today")).toBe("Quick tips\nUse Ride Now today");
  });

  it("strips single-asterisk emphasis but keeps a lone asterisk", () => {
    expect(cleanAssistantText("that is *important* to know")).toBe("that is important to know");
    expect(cleanAssistantText("rated 5* by riders")).toBe("rated 5* by riders");
  });

  it("leaves plain text untouched", () => {
    const plain = "You can schedule a ride at least 3 hours ahead. For sooner pickups, use Ride Now.";
    expect(cleanAssistantText(plain)).toBe(plain);
  });

  it("handles multi-paragraph mixed content", () => {
    const input = "**For your Amazon carpool:** great plan.\n\n- Share the PG-code\n- Everyone saves 30%";
    expect(cleanAssistantText(input)).toBe(
      "For your Amazon carpool: great plan.\n\n• Share the PG-code\n• Everyone saves 30%",
    );
  });
});
