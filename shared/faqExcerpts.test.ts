import { describe, expect, it } from "vitest";
import { anonymizeChatExcerpt, buildFaqExcerptBlock } from "./faqExcerpts";

describe("faqExcerpts", () => {
  it("redacts PII from chat excerpts", () => {
    const raw = "Contact me at jane@example.com or 301-555-1234 for my $25 refund";
    const clean = anonymizeChatExcerpt(raw);
    expect(clean).not.toContain("jane@example.com");
    expect(clean).not.toContain("301-555-1234");
    expect(clean).toContain("[email]");
    expect(clean).toContain("[phone]");
    expect(clean).toContain("[amount]");
  });

  it("builds excerpt block from messages", () => {
    const block = buildFaqExcerptBlock(["How do I tip?", "Where is my driver?"]);
    expect(block).toContain("- User: How do I tip?");
    expect(block).toContain("- User: Where is my driver?");
  });

  it("returns fallback when no excerpts", () => {
    expect(buildFaqExcerptBlock([])).toContain("No recent user messages");
  });
});
