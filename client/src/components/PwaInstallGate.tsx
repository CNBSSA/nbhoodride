import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, Share, Smartphone, CheckCircle2, Loader2, SquarePlus } from "lucide-react";
import { BRAND } from "@shared/branding";
import {
  captureInstallGateFromUrl,
  isAndroidDevice,
  isIosDevice,
  isMobileDevice,
  isAppInstalledContext,
  clearInstallGateRequirement,
  shouldShowInstallGate,
} from "@/lib/pwaInstall";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isInAppBrowser(): boolean {
  return /instagram|fban|fbav|fb_iab|messenger|tiktok|snapchat|line\//i.test(navigator.userAgent);
}

/**
 * Full-screen gate for QR onboarding: users must install (PWA) before using the app.
 * Android: auto-triggers install prompt when the browser offers it.
 * iOS: step-by-step Add to Home Screen (Apple does not allow automatic install).
 */
export function PwaInstallGate() {
  const [visible, setVisible] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installing, setInstalling] = useState(false);
  const autoPromptedRef = useRef(false);

  useEffect(() => {
    captureInstallGateFromUrl();
    const check = () => {
      if (isAppInstalledContext()) {
        clearInstallGateRequirement();
        setVisible(false);
        return;
      }
      setVisible(shouldShowInstallGate());
    };
    check();
    const interval = setInterval(check, 1500);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!visible) return;

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstall);
  }, [visible]);

  useEffect(() => {
    if (!visible || !deferredPrompt || autoPromptedRef.current) return;
    autoPromptedRef.current = true;
    setInstalling(true);
    const timer = setTimeout(async () => {
      try {
        await deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice;
        if (choice.outcome === "accepted") {
          clearInstallGateRequirement();
          setVisible(false);
        }
      } catch {
        /* user dismissed or browser blocked */
      } finally {
        setInstalling(false);
        setDeferredPrompt(null);
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [visible, deferredPrompt]);

  const handleManualInstall = async () => {
    if (!deferredPrompt) return;
    setInstalling(true);
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === "accepted") {
        clearInstallGateRequirement();
        setVisible(false);
      }
    } finally {
      setInstalling(false);
      setDeferredPrompt(null);
    }
  };

  if (!visible) return null;

  const ios = isIosDevice();
  const android = isAndroidDevice();
  const mobile = isMobileDevice();

  return (
    <div
      className="fixed inset-0 z-[300] bg-background flex flex-col max-w-[430px] mx-auto left-0 right-0"
      data-testid="pwa-install-gate"
      role="dialog"
      aria-modal="true"
      aria-labelledby="install-gate-title"
    >
      <div className="flex-1 overflow-y-auto px-5 pt-[max(1.5rem,env(safe-area-inset-top))] pb-6">
        <div className="w-14 h-14 rounded-2xl bg-primary flex items-center justify-center mb-4">
          <Download className="w-7 h-7 text-primary-foreground" />
        </div>
        <h1 id="install-gate-title" className="text-2xl font-bold leading-tight">
          Install {BRAND.appName} first
        </h1>
        <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
          To use PG Ride from this QR code, add the app to your phone. It takes about 30 seconds and
          makes booking, notifications, and safety features work reliably.
        </p>

        {!mobile && (
          <div className="mt-6 rounded-xl border bg-muted/50 p-4 text-sm space-y-2">
            <p className="font-semibold flex items-center gap-2">
              <Smartphone className="w-4 h-4" />
              Open on your phone
            </p>
            <p className="text-muted-foreground text-xs">
              Scan the QR code with your phone camera, or open this link on your mobile device:
            </p>
            <p className="text-xs font-mono break-all bg-background rounded p-2 border">
              {window.location.origin}/?qr=1
            </p>
          </div>
        )}

        {android && (
          <div className="mt-6 space-y-3">
            {installing ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                Opening install…
              </div>
            ) : deferredPrompt ? (
              <Button className="w-full h-12 text-base" onClick={handleManualInstall} data-testid="button-install-gate-android">
                Install now
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">
                If no install dialog appeared, tap the browser menu (⋮) and choose{" "}
                <strong>Install app</strong> or <strong>Add to Home screen</strong>.
              </p>
            )}
          </div>
        )}

        {ios && (
          <div className="mt-6 space-y-3">
            {isInAppBrowser() && (
              <div className="rounded-xl border border-orange-300 bg-orange-50 p-3 text-sm">
                <p className="font-semibold text-orange-800">Open in Safari first</p>
                <p className="text-xs text-orange-800/90 mt-1">
                  This browser cannot install apps. Tap ⋯ → <strong>Open in Safari</strong>, then follow the steps below.
                </p>
              </div>
            )}
            <ol className="space-y-3 text-sm">
              <li className="flex gap-3 items-start">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-xs">
                  1
                </span>
                <span>
                  Tap <Share className="inline w-4 h-4 mx-0.5" /> <strong>Share</strong> at the bottom of Safari
                  (square with arrow).
                </span>
              </li>
              <li className="flex gap-3 items-start">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-xs">
                  2
                </span>
                <span>
                  Scroll and tap <strong>Add to Home Screen</strong>.
                </span>
              </li>
              <li className="flex gap-3 items-start">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-xs">
                  3
                </span>
                <span>
                  Tap <strong>Add</strong>, then open <strong>{BRAND.appName}</strong> from your home screen.
                </span>
              </li>
            </ol>
            <p className="text-xs text-muted-foreground flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-green-600 mt-0.5" />
              This screen will disappear automatically once you open the installed app.
            </p>
          </div>
        )}

        {mobile && !ios && !android && (
          <p className="mt-6 text-sm text-muted-foreground">
            Use your browser menu to install or add this site to your home screen, then open it from there.
          </p>
        )}
      </div>

      <div className="px-5 pb-[max(1rem,env(safe-area-inset-bottom))] text-center">
        <p className="text-[10px] text-muted-foreground">
          Apple and Google require installing from the browser — we cannot skip this step on iPhone.
        </p>
        {import.meta.env.DEV && (
          <button
            type="button"
            className="text-[10px] text-muted-foreground underline mt-2"
            onClick={() => {
              clearInstallGateRequirement();
              setVisible(false);
            }}
            data-testid="install-gate-dev-skip"
          >
            Dev: skip install gate
          </button>
        )}
      </div>
    </div>
  );
}
