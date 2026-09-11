/**
 * The browser's "install this app" offer, captured once and handed to
 * whoever wants to show a button for it. Chrome and Edge fire
 * `beforeinstallprompt` on desktop as well as Android; Safari never does.
 *
 * Used by the requester portal's "Install on this computer" button; the
 * phone-side prompt keeps its own copy of this logic for now.
 */
import { useCallback, useEffect, useState } from "react";
import { isStandalonePwa } from "@/lib/pwaInstall";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function usePwaInstallPrompt(): { canInstall: boolean; installed: boolean; install: () => Promise<boolean> } {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState<boolean>(() => { try { return isStandalonePwa(); } catch { return false; } });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onOffer = (e: Event) => { e.preventDefault(); setDeferred(e as BeforeInstallPromptEvent); };
    const onInstalled = () => { setInstalled(true); setDeferred(null); };
    window.addEventListener("beforeinstallprompt", onOffer);
    window.addEventListener("appinstalled", onInstalled);
    return () => { window.removeEventListener("beforeinstallprompt", onOffer); window.removeEventListener("appinstalled", onInstalled); };
  }, []);

  const install = useCallback(async () => {
    if (!deferred) return false;
    try {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      setDeferred(null);
      return choice.outcome === "accepted";
    } catch {
      return false;
    }
  }, [deferred]);

  return { canInstall: !!deferred && !installed, installed, install };
}
