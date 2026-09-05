import { RefreshCw } from "lucide-react";
import { useAppUpdate } from "@/hooks/useAppUpdate";

/** Slim top bar: "a new version is ready — tap to update". */
export function UpdateBanner() {
  const { updateAvailable, applyUpdate } = useAppUpdate();
  if (!updateAvailable) return null;
  return (
    <button
      type="button"
      onClick={applyUpdate}
      className="fixed top-0 left-1/2 -translate-x-1/2 z-[70] w-full max-w-[430px] bg-primary text-primary-foreground text-sm py-2 px-4 flex items-center justify-center gap-2 shadow"
      data-testid="update-banner"
    >
      <RefreshCw className="w-4 h-4" />
      A new version of PG Ride is ready — tap to update
    </button>
  );
}
