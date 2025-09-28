import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import BottomNavigation from "@/components/BottomNavigation";
import ModeSelector from "@/components/ModeSelector";
import RiderDashboard from "@/pages/RiderDashboard";
import DriverDashboard from "@/pages/DriverDashboard";
import RideHistory from "@/pages/RideHistory";
import RatingsPage from "@/pages/RatingsPage";
import { PaymentsPage } from "@/pages/PaymentsPage";
import Profile from "@/pages/Profile";

export default function Home() {
  const { user } = useAuth();
  const [currentMode, setCurrentMode] = useState<"rider" | "driver">("rider");
  const [activeTab, setActiveTab] = useState("home");

  // Auto-switch to rider mode if user is not a driver and tries to access driver mode
  useEffect(() => {
    if (currentMode === "driver" && !user?.isDriver) {
      setCurrentMode("rider");
    }
  }, [user?.isDriver, currentMode]);

  const handleModeChange = (mode: "rider" | "driver") => {
    if (mode === "driver" && !user?.isDriver) {
      // Redirect to profile to become a driver
      setActiveTab("profile");
      return;
    }
    setCurrentMode(mode);
    setActiveTab("home"); // Reset to home when switching modes
  };

  const renderActiveTab = () => {
    switch (activeTab) {
      case "home":
        return currentMode === "rider" ? <RiderDashboard /> : <DriverDashboard />;
      case "history":
        return <RideHistory />;
      case "ratings":
        return <RatingsPage />;
      case "payments":
        return <PaymentsPage />;
      case "profile":
        return <Profile />;
      default:
        return currentMode === "rider" ? <RiderDashboard /> : <DriverDashboard />;
    }
  };

  return (
    <div className="min-h-screen bg-background max-w-[430px] mx-auto relative">
      {/* Mode selector only shows on home tab */}
      {activeTab === "home" && (
        <ModeSelector 
          currentMode={currentMode} 
          onModeChange={handleModeChange} 
        />
      )}
      
      <div className="pb-20">
        {renderActiveTab()}
      </div>
      
      <BottomNavigation 
        activeTab={activeTab} 
        onTabChange={setActiveTab}
        currentMode={currentMode}
      />
    </div>
  );
}
