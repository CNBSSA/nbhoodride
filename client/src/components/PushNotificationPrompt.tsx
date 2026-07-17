import { useState, useEffect } from "react";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { Button } from "@/components/ui/button";
import { Bell, BellOff, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

export default function PushNotificationPrompt() {
  const { user } = useAuth();
  const { permission, isSubscribed, isSupported, isLoading, subscribe } = usePushNotifications();
  const [dismissed, setDismissed] = useState(false);

  // Only show the prompt if: logged in, notifications supported, not yet granted/denied, not subscribed, not dismissed
  const shouldShow =
    !!user &&
    isSupported &&
    permission === "default" &&
    !isSubscribed &&
    !dismissed;

  useEffect(() => {
    const key = "push-prompt-dismissed";
    if (sessionStorage.getItem(key)) setDismissed(true);
  }, []);

  const handleDismiss = () => {
    setDismissed(true);
    sessionStorage.setItem("push-prompt-dismissed", "1");
  };

  const handleEnable = async () => {
    const granted = await subscribe();
    if (!granted) handleDismiss();
  };

  if (!shouldShow) return null;

  return (
    <div
      // z-30, deliberately BELOW every modal/sheet in the app (all of which
      // use z-50 or higher — DocumentUploadModal, CircuitsTimetableSheet,
      // RiderDashboard's booking sheets at z-[55]/z-[60], BottomNavigation).
      // This banner is mounted unconditionally at the App root (a sibling of
      // Router, not inside any modal), so with an equal z-50 it could win
      // the stacking fight against whatever modal happened to be open and
      // intercept taps meant for it. Confirmed via automated testing: with
      // the Driver Documents modal open, a tap on its "Submit for Review"
      // button (which sits near bottom-20, the same zone this banner
      // occupies) landed on this banner's Enable button instead, so
      // submission silently never fired. Same bug class as PR #87 (a
      // different fixed z-50 layer stealing taps from BottomNavigation).
      className="fixed bottom-20 left-4 right-4 z-30 max-w-sm mx-auto"
      data-testid="push-notification-prompt"
    >
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-xl p-4 flex items-start gap-3">
        <div className="mt-0.5 h-9 w-9 shrink-0 rounded-full bg-primary/10 flex items-center justify-center">
          <Bell className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm">Stay in the loop</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Get notified the moment your driver accepts, arrives, or your ride is complete — even when the app is closed.
          </p>
          <div className="flex gap-2 mt-3">
            <Button
              size="sm"
              className="h-8 text-xs"
              onClick={handleEnable}
              disabled={isLoading}
              data-testid="button-enable-push"
            >
              {isLoading ? "Enabling…" : "Enable Notifications"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs"
              onClick={handleDismiss}
              data-testid="button-dismiss-push"
            >
              Not now
            </Button>
          </div>
        </div>
        <button
          onClick={handleDismiss}
          className="text-muted-foreground hover:text-foreground -mt-1 -mr-1"
          data-testid="button-close-push-prompt"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
