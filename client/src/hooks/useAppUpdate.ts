import { useEffect, useState } from "react";

const CHECK_EVERY_MS = 5 * 60 * 1000;

/**
 * Detects that a newer build is deployed than the one this page is running,
 * by comparing the id baked in at build time with /api/version. Checks on
 * load, whenever the app comes back to the foreground, and every 5 minutes.
 *
 * Returning to the foreground with an update available reloads immediately:
 * the user is not mid-action at that moment, and it is the moment stale
 * bundles cause the most confusion ("I was told it was fixed").
 */
export function useAppUpdate() {
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    const current = typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "dev";
    if (current === "dev") return; // local dev server: never nag
    let cancelled = false;

    const check = async (reloadIfNewer: boolean) => {
      try {
        const res = await fetch("/api/version", { cache: "no-store", credentials: "include" });
        if (!res.ok) return;
        const { id } = await res.json();
        if (!cancelled && id && id !== current) {
          setUpdateAvailable(true);
          if (reloadIfNewer) window.location.reload();
        }
      } catch { /* offline — try again later */ }
    };

    check(false);
    const onVisible = () => { if (document.visibilityState === "visible") check(true); };
    document.addEventListener("visibilitychange", onVisible);
    const timer = setInterval(() => check(false), CHECK_EVERY_MS);
    return () => { cancelled = true; document.removeEventListener("visibilitychange", onVisible); clearInterval(timer); };
  }, []);

  return { updateAvailable, applyUpdate: () => window.location.reload() };
}
