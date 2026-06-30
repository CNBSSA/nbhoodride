import type { MobilityIntentType, ParsedMobilityIntent } from "./genui/schema";

export type { ParsedMobilityIntent };

const HOME_PATTERNS = /\b(home|take me home|go home|ride home)\b/i;
const REPEAT_PATTERNS = /\b(same as last|last time|repeat|again|like before|last friday|last week)\b/i;
const RIDE_PATTERNS = /\b(need a ride|book a ride|get a ride|ride to|drive me)\b/i;
const GUARDIAN_PATTERNS = /\b(track my|share (my )?ride|guardian|family track)\b/i;

/** Rule-based intent parser — no API key required for dev. */
export function parseMobilityUtterance(utterance: string): ParsedMobilityIntent {
  const text = utterance.trim();
  const lower = text.toLowerCase();

  if (!text) {
    return { intentType: "unknown", confidence: 0, label: "What do you need?", utterance: text };
  }

  if (GUARDIAN_PATTERNS.test(lower)) {
    return { intentType: "guardian_share", confidence: 0.85, label: "Share ride with family", utterance: text };
  }

  if (REPEAT_PATTERNS.test(lower)) {
    return { intentType: "repeat_last", confidence: 0.9, label: "Same as last ride", utterance: text };
  }

  if (HOME_PATTERNS.test(lower)) {
    return { intentType: "ride_home", confidence: 0.88, label: "Ride home", utterance: text };
  }

  const toMatch = text.match(/\b(?:to|toward|at)\s+(.+)$/i);
  if (toMatch?.[1]) {
    return {
      intentType: "ride_to",
      confidence: 0.8,
      destinationAddress: toMatch[1].trim(),
      label: `Ride to ${toMatch[1].trim().slice(0, 40)}`,
      utterance: text,
    };
  }

  if (RIDE_PATTERNS.test(lower)) {
    return { intentType: "book_ride", confidence: 0.75, label: "Book a ride", utterance: text };
  }

  if (text.length >= 5 && !text.includes("?")) {
    return {
      intentType: "ride_to",
      confidence: 0.55,
      destinationAddress: text,
      label: `Ride to ${text.slice(0, 40)}`,
      utterance: text,
    };
  }

  return { intentType: "unknown", confidence: 0.3, label: "Try: \"Take me home\" or \"Same as last time\"", utterance: text };
}

export function intentTypeLabel(type: MobilityIntentType): string {
  const map: Record<MobilityIntentType, string> = {
    ride_home: "Ride home",
    ride_to: "Ride to destination",
    repeat_last: "Repeat last ride",
    book_ride: "Book a ride",
    guardian_share: "Family tracking",
    unknown: "Unknown intent",
  };
  return map[type];
}
