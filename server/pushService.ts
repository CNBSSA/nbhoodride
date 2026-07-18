import webpush from "web-push";

const VAPID_PUBLIC_KEY  = process.env.VAPID_PUBLIC_KEY  || "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";
const rawVapidEmail     = process.env.VAPID_EMAIL       || "mailto:admin@pgride.com";
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
  try {
    webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    vapidReady = true;
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
  if (!vapidReady) return false;
  try {
    await webpush.sendNotification(
      { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
      JSON.stringify(payload)
    );
    return true;
  } catch (err: any) {
    if (err.statusCode === 410 || err.statusCode === 404) {
      return false; // Subscription expired — caller should remove it
    }
    console.error("Push send error:", err.message);
    return false;
  }
}

export async function sendPushToSubscriptions(
  subscriptions: PushSubscriptionRecord[],
  payload: PushPayload,
  onExpired?: (endpoint: string) => void
): Promise<void> {
  await Promise.allSettled(
    subscriptions.map(async (sub) => {
      const ok = await sendPushNotification(sub, payload);
      if (!ok && onExpired) onExpired(sub.endpoint);
    })
  );
}

export { webpush };
