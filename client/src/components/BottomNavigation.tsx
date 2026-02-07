import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";

interface BottomNavigationProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  currentMode: "rider" | "driver";
}

export default function BottomNavigation({ activeTab, onTabChange, currentMode }: BottomNavigationProps) {
  const { user } = useAuth();
  
  // Base tabs that are always available
  const commonTabs = [
    { id: 'home', label: 'Home', icon: 'fas fa-home' },
    { id: 'history', label: 'History', icon: 'fas fa-history' },
    { id: 'assistant', label: 'Assistant', icon: 'fas fa-robot' },
    { id: 'ratings', label: 'Ratings', icon: 'fas fa-star' },
  ];

  // Additional tabs based on mode and user status
  const additionalTabs: Array<{ id: string; label: string; icon: string }> = [];
  
  // CASH PAYMENT DEACTIVATED - Payment tab hidden from users
  // Virtual card system is now the only payment method
  // Uncomment below to re-enable cash payment confirmations page
  // if (user?.isDriver && currentMode === "driver") {
  //   additionalTabs.push({ id: 'payments', label: 'Payments', icon: 'fas fa-dollar-sign' });
  // }

  const tabs = [
    ...commonTabs,
    ...additionalTabs,
    { id: 'profile', label: 'Profile', icon: 'fas fa-user' },
  ];

  return (
    <nav className="fixed bottom-0 left-1/2 transform -translate-x-1/2 max-w-[430px] w-full bg-card border-t border-border z-50">
      <div className="flex items-center justify-around py-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={cn(
              "flex flex-col items-center p-2 transition-colors",
              activeTab === tab.id
                ? "text-primary"
                : "text-muted-foreground hover:text-foreground"
            )}
            data-testid={`tab-${tab.id}`}
          >
            <i className={`${tab.icon} text-xl mb-1`} />
            <span className="text-xs">{tab.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
