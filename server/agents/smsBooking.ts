import { sendSms as sendThroughRegistry } from "../smsService";
import type { IStorage } from "../storage";
import { createGuardianShareToken } from "./orchestrator";
import { resolveAppUrl } from "../appUrl";

export async function createTrackingLink(
  storage: IStorage,
  riderUserId: string,
  rideId: string,
  guardianName: string,
): Promise<string> {
  const token = createGuardianShareToken();
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + 24);
  await storage.createGuardianLink({
    riderUserId,
    guardianName,
    shareToken: token,
    activeRideId: rideId,
    expiresAt,
  });
  return token;
}

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.startsWith("1") && digits.length === 11) return `+${digits}`;
  return phone.startsWith("+") ? phone : `+${digits}`;
}

// Every outbound text leaves through the one door (server/smsService.ts):
// the opt-out registry is checked on every send, the number is normalized
// once, and a Twilio outage never fails the ride. This agent used to carry
// a Twilio client of its own, so a tracking link could be texted to a
// number that had replied STOP (corporate audit #335).
async function sendSms(to: string, body: string): Promise<boolean> {
  const result = await sendThroughRegistry(to, body);
  if (!result.sent) console.log(`[sms] booking agent: not sent (${result.reason}${result.detail ? `: ${result.detail}` : ""})`);
  return result.sent;
}

/** E4 — Inbound SMS booking + tracking fallback. */
export async function handleInboundSms(
  storage: IStorage,
  phone: string,
  body: string,
): Promise<string> {
  const normalized = normalizePhone(phone);
  const text = body.trim().toLowerCase();
  const session = await storage.getOrCreateSmsBookingSession(normalized);

  if (text === "help" || text === "ayuda" || text === "aide") {
    return "PG Ride SMS: RIDE <address> to book. STATUS for active trip. TRACK for link. HELP for menu.";
  }

  if (text === "status" || text === "track") {
    if (session.activeRideId) {
      const ride = await storage.getRide(session.activeRideId);
      const base = resolveAppUrl("https://pgride.app");
      if (ride?.riderId) {
        const token = await createTrackingLink(
          storage,
          ride.riderId,
          session.activeRideId,
          "SMS Guest",
        );
        return `Your ride is ${ride.status}. Track: ${base}/guardian/${token}`;
      }
      return `Ride ${ride?.status ?? "unknown"}. Open the PG Ride app for live map.`;
    }
    return "No active ride. Text RIDE followed by your destination address to book.";
  }

  if (text.startsWith("ride ")) {
    const destination = body.slice(5).trim();
    if (!destination) {
      return "Reply RIDE then your destination, e.g. RIDE 3500 East-West Hwy Hyattsville";
    }
    await storage.updateSmsBookingSession(normalized, {
      state: "awaiting_confirm",
      context: { destination, pickupHint: "current location" },
    });
    return `Book to "${destination}"? Reply YES to confirm (app account required to complete payment).`;
  }

  if (text === "yes" && session.state === "awaiting_confirm") {
    await storage.updateSmsBookingSession(normalized, { state: "idle" });
    return "Open PG Ride app to confirm payment and pickup. SMS booking saves your destination — tap Book on the home screen.";
  }

  return "PG Ride: Text RIDE <destination>, STATUS, or HELP.";
}

export async function sendRideTrackingSms(
  storage: IStorage,
  phone: string,
  rideId: string,
  riderUserId: string,
): Promise<boolean> {
  const normalized = normalizePhone(phone);
  const base = resolveAppUrl("https://pgride.app");
  const token = await createTrackingLink(storage, riderUserId, rideId, "SMS");
  const sent = await sendSms(
    normalized,
    `PG Ride: track your trip ${base}/guardian/${token}`,
  );
  if (sent) {
    await storage.updateSmsBookingSession(normalized, {
      activeRideId: rideId,
      state: "active_tracking",
    });
  }
  return sent;
}
