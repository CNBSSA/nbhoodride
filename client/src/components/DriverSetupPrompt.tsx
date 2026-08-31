import { useState } from "react";
import { BellRing, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { usePushNotifications } from "@/hooks/usePushNotifications";

const DISMISS_KEY = "pgride.driverSetupPrompt.dismissed";

function readDismissed(): boolean {
  try { return localStorage.getItem(DISMISS_KEY) === "1"; } catch { return false; }
}

/**
 * One-time "say yes once" setup card for drivers — the web-app equivalent of
 * Uber's first-launch permission ask. Shown on the driver dashboard until ride
 * notifications are enabled (or the driver dismisses it): a one-tap enable for
 * push, plus the one thing only the driver can flip in Android settings
 * (battery optimization for their browser).
 */
export function DriverSetupPrompt() {
  const { isSupported, isSubscribed, isLoading, subscribe } = usePushNotifications();
  const [dismissed, setDismissed] = useState(readDismissed);
  const { toast } = useToast();

  if (!isSupported || isSubscribed || dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try { localStorage.setItem(DISMISS_KEY, "1"); } catch {}
  };

  const enable = async () => {
    const result = await subscribe();
    if (result.ok) {
      toast({
        title: "Ride alerts on 🔔",
        description: "You'll get ride requests even when the app is closed.",
      });
    } else {
      const detail = result.reason === "error" && result.detail ? ` (${result.detail})` : "";
      toast({
        title: "Notifications not enabled",
        description:
          result.reason === "permission_denied"
            ? "Notifications are blocked for this app. Enable them in your phone's settings, then try again."
            : `Couldn't enable notifications. Please try again.${detail}`,
        variant: "destructive",
      });
    }
  };

  return (
    <div
      className="rounded-xl border-2 border-primary/40 bg-primary/5 p-4 space-y-3"
      data-testid="driver-setup-prompt"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <BellRing className="w-5 h-5 text-primary shrink-0" />
          <p className="font-semibold text-sm">Never miss a ride request</p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="text-muted-foreground p-1 -m-1"
          data-testid="driver-setup-dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        Turn on ride alerts so requests reach you even when your screen is off or
        you're in another app. For best results, also set your browser's battery
        use to “Unrestricted” in your phone's Settings → Apps.
      </p>
      <Button
        size="sm"
        className="w-full"
        onClick={enable}
        disabled={isLoading}
        data-testid="driver-setup-enable"
      >
        {isLoading ? "Enabling…" : "Turn on ride alerts"}
      </Button>
    </div>
  );
}
