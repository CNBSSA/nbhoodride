/** Anonymize user chat text before FAQ generation prompts. */

export function anonymizeChatExcerpt(text: string): string {
  return text
    .replace(/\b[\w.+-]+@[\w.-]+\.\w{2,}\b/g, "[email]")
    .replace(/\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g, "[phone]")
    .replace(/\b\d{5}(-\d{4})?\b/g, "[zip]")
    .replace(/\$\d+(?:\.\d{2})?/g, "[amount]")
    .trim();
}

export function buildFaqExcerptBlock(excerpts: string[], maxChars = 12000): string {
  const lines: string[] = [];
  let total = 0;
  for (let i = 0; i < excerpts.length; i++) {
    const line = `- User: ${excerpts[i]}`;
    if (total + line.length > maxChars) break;
    lines.push(line);
    total += line.length;
  }
  if (lines.length === 0) {
    return "No recent user messages available yet.";
  }
  return lines.join("\n");
}
