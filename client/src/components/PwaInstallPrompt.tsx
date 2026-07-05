import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, Share, X } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isIosDevice(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

const DISMISS_KEY = "pwa-install-dismissed";

export default function PwaInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [showIosHint, setShowIosHint] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem(DISMISS_KEY)) setDismissed(true);
    if (isStandalone()) return;

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstall);
  }, []);

  const handleDismiss = () => {
    setDismissed(true);
    sessionStorage.setItem(DISMISS_KEY, "1");
  };

  const handleAndroidInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    handleDismiss();
  };

  if (dismissed || isStandalone()) return null;

  const ios = isIosDevice();
  const showAndroid = !!deferredPrompt;
  const showPrompt = showAndroid || (ios && showIosHint);

  if (!showPrompt && ios) {
    return (
      <button
        type="button"
        onClick={() => setShowIosHint(true)}
        className="fixed bottom-20 right-4 z-40 rounded-full bg-primary text-primary-foreground shadow-lg h-11 px-4 text-xs font-medium flex items-center gap-2"
        data-testid="button-pwa-install-fab"
      >
        <Download className="h-4 w-4" />
        Install app
      </button>
    );
  }

  if (!showPrompt) return null;

  return (
    <div
      className="fixed bottom-20 left-4 right-4 z-50 max-w-sm mx-auto"
      data-testid="pwa-install-prompt"
    >
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-xl p-4">
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 shrink-0 rounded-full bg-primary/10 flex items-center justify-center">
            <Download className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm">Install PG Ride</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {ios ? (
                <>
                  Tap <Share className="inline h-3 w-3 mx-0.5" /> Share, then{" "}
                  <strong>Add to Home Screen</strong> for app-like access.
                </>
              ) : (
                "Add People-Governed rideshare to your home screen — one tap to book."
              )}
            </p>
            <div className="flex gap-2 mt-3">
              {showAndroid ? (
                <Button size="sm" className="h-8 text-xs" onClick={handleAndroidInstall}>
                  Install
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={handleDismiss}
              >
                Not now
              </Button>
            </div>
          </div>
          <button
            type="button"
            onClick={handleDismiss}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
