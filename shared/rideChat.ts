/** In-ride chat validation and helpers (rider ↔ driver). */

export const RIDE_CHAT_MAX_LENGTH = 500;

export const RIDE_CHAT_ACTIVE_STATUSES = [
  "accepted",
  "driver_arriving",
  "in_progress",
] as const;

export type RideChatActiveStatus = (typeof RIDE_CHAT_ACTIVE_STATUSES)[number];

export type RideMessageKind = "quick" | "text";
export type RideMessageRole = "rider" | "driver";

export interface RideMessagePayload {
  id: string;
  rideId: string;
  senderId: string;
  senderRole: RideMessageRole;
  kind: RideMessageKind;
  messageKey: string | null;
  body: string;
  createdAt: string;
}

const PHONE_PATTERN = /(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/;
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

export function isRideChatActiveStatus(status: string): status is RideChatActiveStatus {
  return (RIDE_CHAT_ACTIVE_STATUSES as readonly string[]).includes(status);
}

/** Validate and normalize a free-text ride message body. */
export function validateRideChatBody(
  raw: unknown,
): { ok: true; body: string } | { ok: false; error: string } {
  if (typeof raw !== "string") {
    return { ok: false, error: "Message body is required" };
  }
  const body = raw.trim().replace(/\s+/g, " ");
  if (!body) {
    return { ok: false, error: "Message cannot be empty" };
  }
  if (body.length > RIDE_CHAT_MAX_LENGTH) {
    return { ok: false, error: `Message must be ${RIDE_CHAT_MAX_LENGTH} characters or fewer` };
  }
  if (PHONE_PATTERN.test(body)) {
    return { ok: false, error: "Please do not share phone numbers in chat — use in-app contact" };
  }
  if (EMAIL_PATTERN.test(body)) {
    return { ok: false, error: "Please do not share email addresses in chat" };
  }
  return { ok: true, body };
}

export function buildRideMessageWsPayload(message: RideMessagePayload) {
  return {
    type: "ride_message",
    id: message.id,
    rideId: message.rideId,
    body: message.body,
    kind: message.kind,
    messageKey: message.messageKey,
    fromUserId: message.senderId,
    fromRole: message.senderRole,
    createdAt: message.createdAt,
    // Back-compat for clients still listening for quick-message shape
    text: message.body,
  };
}

/** Normalize WS events into ride chat payloads. */
export function parseRideMessageWsEvent(msg: Record<string, unknown>): RideMessagePayload | null {
  if (msg.type !== "ride_message" && msg.type !== "ride_quick_message") return null;
  const rideId = typeof msg.rideId === "string" ? msg.rideId : null;
  const body = typeof msg.body === "string" ? msg.body : typeof msg.text === "string" ? msg.text : null;
  if (!rideId || !body) return null;
  const fromRole = msg.fromRole === "driver" ? "driver" : "rider";
  return {
    id: typeof msg.id === "string" ? msg.id : `ws-${rideId}-${Date.now()}`,
    rideId,
    senderId: typeof msg.fromUserId === "string" ? msg.fromUserId : "",
    senderRole: fromRole,
    kind: msg.kind === "quick" || msg.type === "ride_quick_message" ? "quick" : "text",
    messageKey: typeof msg.messageKey === "string" ? msg.messageKey : null,
    body,
    createdAt: typeof msg.createdAt === "string" ? msg.createdAt : new Date().toISOString(),
  };
}
