import { embedText, formatRagContext, rankChunks } from "@shared/ragEmbed";
import type { IStorage } from "./storage";

/** Static policy snippets — always indexed for RAG. */
export const STATIC_POLICY_CHUNKS = [
  {
    sourceType: "policy",
    sourceId: "cancellation",
    title: "Ride cancellation",
    content:
      "Riders may cancel before a driver accepts at no charge. After acceptance, cancellation fees may apply per platform policy. Drivers can decline pending rides without penalty.",
  },
  {
    sourceType: "policy",
    sourceId: "payments",
    title: "Payments and wallet",
    content:
      "PG Ride supports card payments via Stripe and a virtual wallet balance. Fares are estimated upfront; final amount may adjust for route changes. Drivers receive earnings to their virtual balance.",
  },
  {
    sourceType: "policy",
    sourceId: "safety",
    title: "Safety features",
    content:
      "Use the SOS button during a ride for emergencies. Share live trip status with trusted contacts. Report disputes from ride history. Safety alerts are reviewed by admins.",
  },
  {
    sourceType: "policy",
    sourceId: "ownership",
    title: "Driver cooperative ownership",
    content:
      "Qualified drivers can earn cooperative ownership shares based on hours and ride volume. Profit distributions are declared by the board and paid to share certificate holders.",
  },
] as const;

export async function syncKnowledgeIndex(storage: IStorage): Promise<number> {
  let count = 0;

  for (const chunk of STATIC_POLICY_CHUNKS) {
    await storage.upsertKnowledgeChunk({
      sourceType: chunk.sourceType,
      sourceId: chunk.sourceId,
      title: chunk.title,
      content: chunk.content,
      embedding: embedText(`${chunk.title}\n${chunk.content}`),
    });
    count++;
  }

  const faqs = await storage.getFaqEntries(true);
  for (const faq of faqs) {
    await storage.upsertKnowledgeChunk({
      sourceType: "faq",
      sourceId: faq.id,
      title: faq.question,
      content: `${faq.question}\n${faq.answer}`,
      embedding: embedText(`${faq.question}\n${faq.answer}`),
    });
    count++;
  }

  const insights = await storage.getPlatformInsights(30);
  for (const insight of insights) {
    await storage.upsertKnowledgeChunk({
      sourceType: "insight",
      sourceId: insight.id,
      title: insight.title,
      content: [insight.title, insight.description].filter(Boolean).join("\n"),
      embedding: embedText([insight.title, insight.description].filter(Boolean).join("\n")),
    });
    count++;
  }

  return count;
}

export async function retrieveKnowledgeContext(
  storage: IStorage,
  query: string,
  limit = 5,
): Promise<string> {
  const chunks = await storage.getAllKnowledgeChunks();
  if (chunks.length === 0) {
    await syncKnowledgeIndex(storage);
    const refreshed = await storage.getAllKnowledgeChunks();
    const ranked = rankChunks(query, refreshed, limit);
    return formatRagContext(ranked);
  }
  const ranked = rankChunks(query, chunks, limit);
  return formatRagContext(ranked);
}
