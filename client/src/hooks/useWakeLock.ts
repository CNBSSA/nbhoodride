import { useEffect, useRef } from "react";

/**
 * Screen Wake Lock — keep the phone's screen awake while `active` is true.
 *
 * Used by the driver dashboard while the driver is ONLINE, so the phone never
 * locks mid-shift and an incoming ride request isn't missed because the screen
 * dozed off (the closest a web app gets to Uber's "stay on top" behavior).
 *
 * The browser silently releases the lock whenever the tab is hidden, so we
 * re-acquire on visibilitychange. Unsupported browsers no-op — push
 * notifications still cover the locked-phone case.
 */
export function useWakeLock(active: boolean) {
  const lockRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;

    let cancelled = false;

    const acquire = async () => {
      if (cancelled || document.visibilityState !== "visible") return;
      try {
        lockRef.current = await navigator.wakeLock.request("screen");
      } catch {
        // Denied (battery saver, etc.) — non-fatal; push notifications remain.
      }
    };

    const onVisibility = () => { void acquire(); };

    void acquire();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      lockRef.current?.release().catch(() => {});
      lockRef.current = null;
    };
  }, [active]);
}
