import webpush from "web-push";
import { checkVapidPublicKey } from "@shared/vapidKey";

// Trimmed: a trailing newline or stray space pasted into the Variables tab is
// invisible in the dashboard but makes the key unusable in both the browser
// and web-push.
const VAPID_PUBLIC_KEY  = (process.env.VAPID_PUBLIC_KEY  || "").trim();
const VAPID_PRIVATE_KEY = (process.env.VAPID_PRIVATE_KEY || "").trim();
const rawVapidEmail     = (process.env.VAPID_EMAIL       || "mailto:admin@pgride.com").trim();
const VAPID_EMAIL       = rawVapidEmail.startsWith("mailto:") || rawVapidEmail.startsWith("https://")
  ? rawVapidEmail
  : `mailto:${rawVapidEmail}`;

// web-push validates key format synchronously and throws on a malformed
// key. Letting that escape here crashes the whole import chain before the
// HTTP server ever binds its port — Railway's healthcheck then fails
// forever and the ENTIRE app goes down over an optional feature. Web push
// is optional; degrade to disabled instead of crashing the process.
let vapidReady = false;
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  // Shape-check the public key first: web-push's own error is generic, and the
  // browser's is worse ("applicationServerKey is not valid"), so name the real
  // problem (private key pasted, truncated value, copied quotes) in the log.
  const shape = checkVapidPublicKey(VAPID_PUBLIC_KEY);
  if (!shape.valid) {
    console.error(`[push] VAPID_PUBLIC_KEY rejected — web push disabled. ${shape.error}`);
  }
  try {
    if (!shape.valid) throw new Error(shape.error);
    webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    vapidReady = true;
    console.log("[push] Web push configured — VAPID key pair accepted.");
  } catch (err: any) {
    console.error(
      "[push] Invalid VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY — web push disabled. " +
      "Set valid VAPID key values in the service Variables tab, or clear both to disable web push. " +
      `(${err.message})`
    );
  }
}

export function isPushConfigured(): boolean {
  return vapidReady;
}

/**
 * The public key clients must subscribe with — the trimmed, validated twin of
 * the private key this server signs with. Serving this at runtime keeps the
 * browser and the server on the same key even if the build-time
 * VITE_VAPID_PUBLIC_KEY drifts.
 */
export function getVapidPublicKey(): string {
  return vapidReady ? VAPID_PUBLIC_KEY : "";
}

export interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  tag?: string;
  url?: string;
  requireInteraction?: boolean;
  actions?: { action: string; title: string }[];
}

export interface PushSubscriptionRecord {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export async function sendPushNotification(
  subscription: PushSubscriptionRecord,
  payload: PushPayload
): Promise<boolean> {
  return (await sendPushOutcome(subscription, payload)) === "sent";
}

/**
 * Sent, expired (the push service says the subscription is gone: 404/410)
 * or failed (anything else — a 5xx, a timeout). Only an expired one is
 * removed (code review 2026-10-06): a passing outage used to delete the
 * rider's subscription for good, ride-critical pushes included.
 */
export async function sendPushOutcome(
  subscription: PushSubscriptionRecord,
  payload: PushPayload
): Promise<"sent" | "expired" | "failed"> {
  if (!vapidReady) return "failed";
  try {
    await webpush.sendNotification(
      { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
      JSON.stringify(payload),
      { timeout: 10_000 },
    );
    return "sent";
  } catch (err: any) {
    // Every failure is written down (reliability audit 2026-09-29): a pruned
    // subscription and a send error used to leave no trace, so nobody could
    // say how many riders a push never reached. Fire-and-forget, imported
    // here so the module stays free of the database for its unit tests.
    const expired = err?.statusCode === 410 || err?.statusCode === 404;
    const message = `${expired ? "pruned" : "failed"} ${err?.statusCode ?? ""} ${String(err?.message ?? err).slice(0, 200)}`.trim();
    if (!expired) console.error("Push send error:", err?.message);
    import("./reliabilityEvents")
      .then((m) => m.recordReliabilityEvent({ kind: expired ? "push_pruned" : "push_failed", page: payload.tag ?? null, message }))
      .catch(() => {});
    return expired ? "expired" : "failed";
  }
}

export async function sendPushToSubscriptions(
  subscriptions: PushSubscriptionRecord[],
  payload: PushPayload,
  onExpired?: (endpoint: string) => void
): Promise<void> {
  await Promise.allSettled(
    subscriptions.map(async (sub) => {
      const outcome = await sendPushOutcome(sub, payload);
      if (outcome === "expired" && onExpired) onExpired(sub.endpoint);
    })
  );
}

export { webpush };
