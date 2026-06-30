/** Lightweight deterministic embeddings for RAG without an external API. */

export const RAG_EMBEDDING_DIM = 384;

export function embedText(text: string, dims = RAG_EMBEDDING_DIM): number[] {
  const vec = new Array<number>(dims).fill(0);
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
  for (const token of tokens) {
    let h = 0;
    for (let i = 0; i < token.length; i++) {
      h = ((h << 5) - h + token.charCodeAt(i)) | 0;
    }
    const idx = Math.abs(h) % dims;
    vec[idx] += 1;
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export function keywordBoost(query: string, text: string): number {
  const qTokens = new Set(
    query.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((t) => t.length > 2),
  );
  if (qTokens.size === 0) return 0;
  const lower = text.toLowerCase();
  let hits = 0;
  for (const t of Array.from(qTokens)) {
    if (lower.includes(t)) hits++;
  }
  return hits / qTokens.size;
}

export interface RankedChunk {
  title: string;
  content: string;
  sourceType: string;
  score: number;
}

export function rankChunks(
  query: string,
  chunks: Array<{ title: string; content: string; sourceType: string; embedding?: number[] | null }>,
  limit = 5,
): RankedChunk[] {
  const queryVec = embedText(query);
  const scored = chunks.map((c) => {
    const vecScore = c.embedding?.length
      ? cosineSimilarity(queryVec, c.embedding)
      : 0;
    const kw = keywordBoost(query, `${c.title} ${c.content}`);
    return { ...c, score: vecScore * 0.7 + kw * 0.3 };
  });
  return scored
    .filter((c) => c.score > 0.05)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ title, content, sourceType, score }) => ({ title, content, sourceType, score }));
}

export function formatRagContext(chunks: RankedChunk[]): string {
  if (chunks.length === 0) return "";
  const lines = chunks.map(
    (c, i) => `[${i + 1}] (${c.sourceType}) ${c.title}\n${c.content}`,
  );
  return `--- RELEVANT PLATFORM KNOWLEDGE (cite when helpful) ---\n${lines.join("\n\n")}\n--- END KNOWLEDGE ---`;
}
