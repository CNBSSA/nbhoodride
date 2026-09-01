/**
 * The assistant chat renders plain text (no markdown renderer), and the
 * system prompt tells the model to write plain text — but models drift.
 * This cleaner converts any markdown that slips through into tidy text
 * instead of showing riders literal asterisks and dashes.
 */
export function cleanAssistantText(text: string): string {
  return (
    text
      // "### Heading" → "Heading"
      .replace(/^#{1,6}\s+/gm, "")
      // "**bold**" / "__bold__" → "bold"
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/__([^_]+)__/g, "$1")
      // "*italic*" → "italic" (only when tightly wrapping a word — avoids
      // eating a genuine asterisk in e.g. "5* rating")
      .replace(/(^|\s)\*(\S[^*]*\S|\S)\*(?=[\s.,!?:;)]|$)/g, "$1$2")
      // "- item" / "* item" / "+ item" at line start → "• item"
      .replace(/^[ \t]*[-*+][ \t]+/gm, "• ")
      // "`code`" → "code"
      .replace(/`([^`]+)`/g, "$1")
  );
}
