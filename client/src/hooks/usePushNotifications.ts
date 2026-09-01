import { useState, useEffect, useCallback } from "react";
import { apiRequest } from "@/lib/queryClient";
import { checkVapidPublicKey } from "@shared/vapidKey";

// Build-time copy, used only as a fallback. The authoritative key comes from
// the server at runtime (see resolveVapidPublicKey): VITE_ variables are baked
// into the bundle at build time, so a rotated key would leave every client
// signing up with a stale one until the next rebuild — and a bad build-time
// value produced the opaque "applicationServerKey is not valid" failure.
const BUILD_TIME_VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

/**
 * The key the SERVER actually signs pushes with wins. Falls back to the
 * build-time value only when the endpoint is unreachable (offline/older
 * server), so this can never be worse than the previous behaviour.
 */
async function resolveVapidPublicKey(): Promise<string> {
  try {
    const res = await fetch("/api/push/vapid-key", { credentials: "include" });
    if (res.ok) {
      const { publicKey } = await res.json();
      if (typeof publicKey === "string" && publicKey.trim()) return publicKey.trim();
    }
  } catch {
    /* fall through to the build-time key */
  }
  return (BUILD_TIME_VAPID_PUBLIC_KEY ?? "").trim();
}

export type PushPermission = "default" | "granted" | "denied" | "unsupported";

export type SubscribeResult =
  | { ok: true }
  | {
      ok: false;
      reason: "unsupported" | "not_configured" | "invalid_key" | "permission_denied" | "error";
      detail?: string;
    };

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
    setIsLoading(true);
    try {
      // Resolve and validate the key BEFORE touching PushManager, so a
      // misconfigured key reports what is actually wrong instead of the
      // browser's opaque "applicationServerKey is not valid".
      const vapidPublicKey = await resolveVapidPublicKey();
      if (!vapidPublicKey) {
        console.error("Push subscribe error: no VAPID public key from server or build");
        return { ok: false, reason: "not_configured" };
      }
      const keyCheck = checkVapidPublicKey(vapidPublicKey);
      if (!keyCheck.valid) {
        console.error("Push subscribe error: invalid VAPID public key —", keyCheck.error);
        return { ok: false, reason: "invalid_key", detail: keyCheck.error };
      }
      const appServerKey = keyCheck.bytes;

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
