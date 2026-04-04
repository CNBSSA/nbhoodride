import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { Home, Clock, Bot, Star, User } from "lucide-react";

interface BottomNavigationProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  currentMode: "rider" | "driver";
}

export default function BottomNavigation({ activeTab, onTabChange, currentMode }: BottomNavigationProps) {
  const { user } = useAuth();
  
  const tabs = [
    { id: 'home', label: 'Home', Icon: Home },
    { id: 'history', label: 'History', Icon: Clock },
    { id: 'assistant', label: 'Assistant', Icon: Bot },
    { id: 'ratings', label: 'Ratings', Icon: Star },
    { id: 'profile', label: 'Profile', Icon: User },
  ];

  return (
    <nav
      className="fixed bottom-0 left-1/2 -translate-x-1/2 max-w-[430px] w-full bg-white border-t border-gray-200 z-50"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div className="flex items-center justify-around px-1 pt-1 pb-1">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={cn(
                "flex flex-col items-center justify-center rounded-xl transition-colors min-w-[56px] min-h-[44px] py-1 px-2",
                isActive
                  ? "text-blue-600"
                  : "text-gray-400 active:text-gray-600"
              )}
              data-testid={`tab-${tab.id}`}
            >
              <div className={cn(
                "w-9 h-9 rounded-xl flex items-center justify-center mb-0.5 transition-colors",
                isActive ? "bg-blue-50" : ""
              )}>
                <tab.Icon className={cn("w-5 h-5", isActive ? "text-blue-600" : "text-gray-400")} />
              </div>
              <span className={cn(
                "text-[10px] font-medium leading-none",
                isActive ? "text-blue-600" : "text-gray-400"
              )}>
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
