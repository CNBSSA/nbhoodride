import { RefreshCw } from "lucide-react";
import { useAppUpdate } from "@/hooks/useAppUpdate";

/**
 * Slim top bar: "a new version is ready — tap to update".
 *
 * top-0 means the very top of the screen once the app is installed, where
 * iPhone puts the clock and the Dynamic Island — so the inset is padded for
 * the same way the install gate and the bottom navigation already do it.
 * Without it the one affordance telling a rider to pick up a fix sits behind
 * the status bar on exactly the phones that most need to be told.
 */
export function UpdateBanner() {
  const { updateAvailable, applyUpdate } = useAppUpdate();
  if (!updateAvailable) return null;
  return (
    <button
      type="button"
      onClick={applyUpdate}
      className="fixed top-0 left-1/2 -translate-x-1/2 z-[70] w-full max-w-[430px] bg-primary text-primary-foreground text-sm pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] px-4 flex items-center justify-center gap-2 shadow"
      data-testid="update-banner"
    >
      <RefreshCw className="w-4 h-4" />
      A new version of PG Ride is ready — tap to update
    </button>
  );
}
