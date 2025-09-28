import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";

interface ModeSelectorProps {
  currentMode: "rider" | "driver";
  onModeChange: (mode: "rider" | "driver") => void;
}

export default function ModeSelector({ currentMode, onModeChange }: ModeSelectorProps) {
  const { user } = useAuth();

  return (
    <div className="bg-card border-b border-border p-4">
      <div className="max-w-[430px] mx-auto">
        <div className="flex bg-muted rounded-lg p-1 mb-2">
          <button
            onClick={() => onModeChange("rider")}
            className={cn(
              "flex-1 py-3 px-4 rounded-md text-sm font-medium transition-all duration-200 flex items-center justify-center",
              currentMode === "rider"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
            data-testid="mode-rider"
          >
            <i className="fas fa-user mr-2" />
            I need a ride
          </button>
          
          {user?.isDriver ? (
            <button
              onClick={() => onModeChange("driver")}
              className={cn(
                "flex-1 py-3 px-4 rounded-md text-sm font-medium transition-all duration-200 flex items-center justify-center",
                currentMode === "driver"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
              data-testid="mode-driver"
            >
              <i className="fas fa-car mr-2" />
              I'm driving
            </button>
          ) : (
            <button
              onClick={() => onModeChange("driver")}
              className="flex-1 py-3 px-4 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all duration-200 flex items-center justify-center border border-muted"
              data-testid="mode-driver-signup"
            >
              <i className="fas fa-car mr-2" />
              Become a driver
            </button>
          )}
        </div>
        
        <div className="text-center text-xs text-muted-foreground">
          {currentMode === "rider" ? (
            <>
              <i className="fas fa-map-marker-alt mr-1" />
              Find nearby drivers and book rides
            </>
          ) : user?.isDriver ? (
            <>
              <i className="fas fa-dollar-sign mr-1" />
              Accept rides and start earning
            </>
          ) : (
            <>
              <i className="fas fa-info-circle mr-1" />
              Complete driver signup to start earning
            </>
          )}
        </div>
      </div>
    </div>
  );
}