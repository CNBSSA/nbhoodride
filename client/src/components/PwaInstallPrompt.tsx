import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, Share, SquarePlus, X } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isIosDevice(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

/** In-app browsers (Instagram, Facebook, Messenger, TikTok…) have no
 *  "Add to Home Screen" — the user must reopen the page in real Safari. */
function isInAppBrowser(): boolean {
  return /instagram|fban|fbav|fb_iab|messenger|tiktok|snapchat|line\//i.test(navigator.userAgent);
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

  if (!showAndroid && ios && !showIosHint) {
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

  // iOS: Apple does not allow one-tap installs from the browser, so this is a
  // full walkthrough sheet (with overlay so it can't be missed) instead of the
  // old two-line hint that looked like the button "did nothing".
  if (ios && showIosHint) {
    const inApp = isInAppBrowser();
    return (
      <div className="fixed inset-0 z-[70] flex items-end justify-center" data-testid="pwa-install-prompt">
        <div className="absolute inset-0 bg-black/50" onClick={() => setShowIosHint(false)} />
        <div className="relative w-full max-w-[430px] bg-white dark:bg-gray-900 rounded-t-3xl shadow-2xl p-6 pb-8">
          <div className="flex items-center justify-between mb-1">
            <p className="font-bold text-lg">Add PG Ride to your iPhone</p>
            <button
              type="button"
              onClick={() => setShowIosHint(false)}
              className="text-muted-foreground hover:text-foreground p-1"
              aria-label="Close"
              data-testid="button-close-ios-hint"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <p className="text-xs text-muted-foreground mb-4">
            iPhone doesn't allow one-tap installs — it takes three quick steps in Safari:
          </p>

          {inApp && (
            <div className="mb-4 rounded-xl border border-orange-300 bg-orange-50 dark:bg-orange-950/30 p-3">
              <p className="text-sm font-semibold text-orange-700">First: open this page in Safari</p>
              <p className="text-xs text-orange-700/80 mt-0.5">
                You're in an app's built-in browser, which can't add to your home screen. Tap the ⋯ menu and
                choose <strong>Open in Safari</strong> (or type peoplegoverned.com in Safari), then follow the steps below.
              </p>
            </div>
          )}

          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="h-8 w-8 shrink-0 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-sm">1</div>
              <div className="flex-1">
                <p className="text-sm font-semibold flex items-center gap-1.5">
                  Tap the Share button <Share className="inline h-4 w-4 text-primary" />
                </p>
                <p className="text-xs text-muted-foreground">It's at the bottom center of Safari — a square with an arrow pointing up.</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="h-8 w-8 shrink-0 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-sm">2</div>
              <div className="flex-1">
                <p className="text-sm font-semibold flex items-center gap-1.5">
                  Tap "Add to Home Screen" <SquarePlus className="inline h-4 w-4 text-primary" />
                </p>
                <p className="text-xs text-muted-foreground">Scroll down the share menu a little if you don't see it right away.</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="h-8 w-8 shrink-0 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-sm">3</div>
              <div className="flex-1">
                <p className="text-sm font-semibold">Tap "Add"</p>
                <p className="text-xs text-muted-foreground">PG Ride appears on your home screen and opens full-screen, just like an app.</p>
              </div>
            </div>
          </div>

          <Button
            variant="outline"
            className="w-full mt-5"
            onClick={() => setShowIosHint(false)}
            data-testid="button-ios-hint-done"
          >
            Got it
          </Button>
        </div>
      </div>
    );
  }

  if (!showAndroid) return null;

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
              Add People-Governed rideshare to your home screen — one tap to book.
            </p>
            <div className="flex gap-2 mt-3">
              <Button size="sm" className="h-8 text-xs" onClick={handleAndroidInstall}>
                Install
              </Button>
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
