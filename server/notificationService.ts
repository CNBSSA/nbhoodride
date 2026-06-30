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

  if (input.push !== false) {
    const payload: PushPayload = {
      title: input.title,
      body: input.body,
      tag: input.tag ?? input.type,
      url: input.url ?? "/",
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
