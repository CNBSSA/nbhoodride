import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { User, Car } from "lucide-react";

interface ModeSelectorProps {
  currentMode: "rider" | "driver";
  onModeChange: (mode: "rider" | "driver") => void;
}

export default function ModeSelector({ currentMode, onModeChange }: ModeSelectorProps) {
  const { user } = useAuth();

  return (
    <div className="bg-white border-b border-gray-100 px-4 py-3">
      <div className="max-w-[430px] mx-auto">
        <div className="flex bg-gray-100 rounded-2xl p-1">
          <button
            onClick={() => onModeChange("rider")}
            className={cn(
              "flex-1 py-2.5 px-4 rounded-xl text-sm font-semibold transition-all duration-200 flex items-center justify-center gap-2",
              currentMode === "rider"
                ? "bg-blue-600 text-white shadow-sm shadow-blue-600/20"
                : "text-gray-500 hover:text-gray-700"
            )}
            data-testid="mode-rider"
          >
            <User className="w-4 h-4" />
            I need a ride
          </button>
          
          {user?.isDriver ? (
            <button
              onClick={() => onModeChange("driver")}
              className={cn(
                "flex-1 py-2.5 px-4 rounded-xl text-sm font-semibold transition-all duration-200 flex items-center justify-center gap-2",
                currentMode === "driver"
                  ? "bg-blue-600 text-white shadow-sm shadow-blue-600/20"
                  : "text-gray-500 hover:text-gray-700"
              )}
              data-testid="mode-driver"
            >
              <Car className="w-4 h-4" />
              I'm driving
            </button>
          ) : (
            <button
              onClick={() => onModeChange("driver")}
              className="flex-1 py-2.5 px-4 rounded-xl text-sm font-semibold text-gray-500 hover:text-gray-700 transition-all duration-200 flex items-center justify-center gap-2"
              data-testid="mode-driver-signup"
            >
              <Car className="w-4 h-4" />
              Become a driver
            </button>
          )}
        </div>
        
        <p className="text-center text-xs text-gray-400 mt-2">
          {currentMode === "rider" 
            ? "Find nearby drivers and book rides"
            : user?.isDriver 
              ? "Accept rides and start earning"
              : "Complete driver signup to start earning"
          }
        </p>
      </div>
    </div>
  );
}
