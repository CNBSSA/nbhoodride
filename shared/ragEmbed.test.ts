import { describe, expect, it } from "vitest";
import { embedText, cosineSimilarity, rankChunks, formatRagContext } from "./ragEmbed";

describe("ragEmbed", () => {
  it("produces normalized vectors", () => {
    const v = embedText("ride payment safety");
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(v.length).toBe(384);
    expect(norm).toBeCloseTo(1, 5);
  });

  it("ranks similar content higher", () => {
    const query = "how do I cancel my ride";
    const chunks = [
      { title: "Cancel ride", content: "You can cancel a ride before the driver arrives.", sourceType: "faq", embedding: embedText("cancel ride driver") },
      { title: "Weather", content: "Maryland weather varies by season.", sourceType: "faq", embedding: embedText("weather season") },
    ];
    const ranked = rankChunks(query, chunks, 2);
    expect(ranked[0]?.title).toBe("Cancel ride");
    expect(ranked[0]!.score).toBeGreaterThan(ranked[1]?.score ?? 0);
  });

  it("formats RAG context block", () => {
    const block = formatRagContext([
      { title: "Q", content: "A", sourceType: "faq", score: 0.9 },
    ]);
    expect(block).toContain("RELEVANT PLATFORM KNOWLEDGE");
    expect(block).toContain("(faq) Q");
  });

  it("cosine similarity is 1 for identical vectors", () => {
    const v = embedText("test");
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 5);
  });
});
