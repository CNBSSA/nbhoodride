import { useState } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";

interface BottomNavigationProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

export default function BottomNavigation({ activeTab, onTabChange }: BottomNavigationProps) {
  const { user } = useAuth();
  
  const baseTabs = [
    { id: 'rider-home', label: 'Home', icon: 'fas fa-home' },
    { id: 'driver-dashboard', label: 'Drive', icon: 'fas fa-tachometer-alt' },
    { id: 'ride-history', label: 'History', icon: 'fas fa-history' },
    { id: 'ratings', label: 'Ratings', icon: 'fas fa-star' },
  ];

  // Add payments tab for drivers
  const driverTabs = user?.isDriver 
    ? [{ id: 'payments', label: 'Payments', icon: 'fas fa-dollar-sign' }]
    : [];

  const tabs = [
    ...baseTabs,
    ...driverTabs,
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
