/**
 * ⚠️  HONESTY NOTE — read before changing this file or relying on its output
 * ──────────────────────────────────────────────────────────────────────────
 *
 * This file is named `ragEmbed.ts` and exports a function called `embedText`,
 * but what it computes is **NOT a semantic embedding**. It is a deterministic
 * hash-bucket bag-of-words signature:
 *
 *   - Tokenize: lowercase, ASCII-only, split on whitespace
 *   - For each token, hash to one of `RAG_EMBEDDING_DIM` (= 384) buckets
 *   - Count token frequencies into the bucket they hash to
 *   - L2-normalize the resulting vector
 *
 * Cosine similarity over these vectors is therefore a sparse token-collision
 * score, NOT semantic similarity. Two sentences with no shared words but
 * identical meaning ("auto" vs "car") will score 0. Two unrelated sentences
 * that happen to share a function word may score >0. The 384-dim float
 * representation is shaped like an embedding so it can drop into pgvector
 * later — but treating these vectors as if they captured meaning is a
 * documented falsehood.
 *
 * Why we keep this anyway:
 *   - Adding a real embedding provider (Voyage, OpenAI text-embedding-3,
 *     Cohere) is a separate decision with cost + vendor implications.
 *   - The current corpus (FAQ + platform insights + policies) is small.
 *   - At small scale, bag-of-words + the `keywordBoost` term in `rankChunks`
 *     actually returns useful results most of the time — the user-facing
 *     bug surfaces are typo-tolerance and synonyms, not breakage.
 *
 * What this means for callers:
 *   - Do not rely on retrieving conceptually-related content. The retrieval
 *     is essentially lexical, with overlap weighted by collision rate.
 *   - Do not claim the system has "RAG with semantic recall" in
 *     user-facing docs.
 *   - When a real embedding is plugged in, the vector column type stays
 *     the same (float[]); only this file changes, and the result is a
 *     real semantic upgrade rather than a re-architecture.
 *
 * `lexicalSignature` is exported as a synonym so new call-sites can name
 * the function honestly. `embedText` is kept as a legacy alias because
 * three call-sites in server/ragService.ts already use it.
 */

export const RAG_EMBEDDING_DIM = 384;

/**
 * Compute a 384-dim hash-bucket bag-of-words signature. See the file
 * header for what this is NOT (a semantic embedding).
 */
export function lexicalSignature(text: string, dims = RAG_EMBEDDING_DIM): number[] {
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

/**
 * Legacy alias. Retained so existing imports keep working. Prefer
 * `lexicalSignature` for new code so the caller reads honestly.
 */
export const embedText = lexicalSignature;

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
  const queryVec = lexicalSignature(query);
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
