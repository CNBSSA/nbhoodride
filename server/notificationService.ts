import { storage } from "./storage";
import { sendPushToSubscriptions, type PushPayload } from "./pushService";

export interface UserNotificationInput {
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  tag?: string;
  url?: string;
  /** Send web push when VAPID is configured (default true). */
  push?: boolean;
  /** Notification stays on screen until the user interacts (ride requests). */
  requireInteraction?: boolean;
}

/** Persist in-app notification and optionally mirror to web push. */
export async function deliverUserNotification(userId: string, input: UserNotificationInput) {
  const notification = await storage.createInAppNotification({
    userId,
    type: input.type,
    title: input.title,
    body: input.body,
    data: input.data,
  });

  let allowPush = input.push !== false;
  if (allowPush && input.type !== "sos" && input.type !== "emergency") {
    try {
      const prefs = await storage.getUserRidePreferences(userId);
      if (prefs.minimizeNotifications || (prefs.calmRideMode && prefs.calmRideMode !== "off")) {
        allowPush = false;
      }
    } catch {
      /* preferences optional */
    }
  }

  if (allowPush) {
    const payload: PushPayload = {
      title: input.title,
      body: input.body,
      tag: input.tag ?? input.type,
      url: input.url ?? "/",
      // Ride requests must not slide away while the driver's phone is in a
      // pocket — default sticky for that type, overridable per call.
      requireInteraction: input.requireInteraction ?? input.type === "new-ride-request",
    };
    storage
      .getPushSubscriptionsByUser(userId)
      .then((subs) =>
        sendPushToSubscriptions(subs, payload, (ep) => storage.deletePushSubscription(ep)),
      )
      .catch(console.error);
  }

  return notification;
}
