import { useState, useEffect, useCallback } from "react";
import { apiRequest } from "@/lib/queryClient";

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string;

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from(rawData, (c) => c.charCodeAt(0));
}

export type PushPermission = "default" | "granted" | "denied" | "unsupported";

export type SubscribeResult =
  | { ok: true }
  | { ok: false; reason: "unsupported" | "not_configured" | "permission_denied" | "error"; detail?: string };

export function usePushNotifications() {
  const [permission, setPermission] = useState<PushPermission>("default");
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const isSupported =
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;

  useEffect(() => {
    if (!isSupported) {
      setPermission("unsupported");
      return;
    }
    setPermission(Notification.permission as PushPermission);
    checkSubscription();
  }, [isSupported]);

  async function checkSubscription() {
    if (!isSupported) return;
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      setIsSubscribed(!!sub);
    } catch {
      setIsSubscribed(false);
    }
  }

  const subscribe = useCallback(async (): Promise<SubscribeResult> => {
    if (!isSupported) return { ok: false, reason: "unsupported" };
    if (!VAPID_PUBLIC_KEY) {
      console.error("Push subscribe error: VITE_VAPID_PUBLIC_KEY is not configured");
      return { ok: false, reason: "not_configured" };
    }
    setIsLoading(true);
    try {
      // Register service worker if not already
      let reg = await navigator.serviceWorker.getRegistration("/sw.js");
      if (!reg) {
        reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      }
      // Always wait for an ACTIVE worker — pushManager.subscribe throws
      // InvalidStateError against a registration that's still installing.
      await navigator.serviceWorker.ready;

      // Request permission
      const perm = await Notification.requestPermission();
      setPermission(perm as PushPermission);
      if (perm !== "granted") return { ok: false, reason: "permission_denied" };

      const appServerKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);

      // A leftover browser-side subscription created under a DIFFERENT VAPID
      // key makes subscribe() throw InvalidStateError forever ("a subscription
      // with a different applicationServerKey already exists") — the classic
      // aftermath of a key rotation. If one exists with the same key, just
      // re-save it to the server (the toggle can show "off" when the server
      // lost the row). If the key differs or can't be read, clear it and
      // subscribe fresh.
      let sub = await reg.pushManager.getSubscription();
      if (sub) {
        const existingKey = sub.options?.applicationServerKey
          ? new Uint8Array(sub.options.applicationServerKey)
          : null;
        const sameKey =
          !!existingKey &&
          existingKey.length === appServerKey.length &&
          existingKey.every((b, i) => b === appServerKey[i]);
        if (!sameKey) {
          try { await sub.unsubscribe(); } catch { /* fresh subscribe below either way */ }
          sub = null;
        }
      }

      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: appServerKey,
        });
      }

      const json = sub.toJSON();
      await apiRequest("POST", "/api/push/subscribe", {
        endpoint: json.endpoint,
        p256dh: (json.keys as any)?.p256dh,
        auth: (json.keys as any)?.auth,
      });

      setIsSubscribed(true);
      return { ok: true };
    } catch (err: any) {
      console.error("Push subscribe error:", err);
      // Pass the real error up so the UI can show it — "please try again"
      // with no detail made field failures undiagnosable.
      const detail = [err?.name, err?.message].filter(Boolean).join(": ").slice(0, 140);
      return { ok: false, reason: "error", detail: detail || undefined };
    } finally {
      setIsLoading(false);
    }
  }, [isSupported]);

  const unsubscribe = useCallback(async (): Promise<boolean> => {
    if (!isSupported) return false;
    setIsLoading(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      if (!reg) return false;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await apiRequest("POST", "/api/push/unsubscribe", { endpoint: sub.endpoint });
        await sub.unsubscribe();
        setIsSubscribed(false);
      }
      return true;
    } catch (err) {
      console.error("Push unsubscribe error:", err);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [isSupported]);

  return { permission, isSubscribed, isSupported, isLoading, subscribe, unsubscribe };
}
