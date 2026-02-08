import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useLocation } from "wouter";
import BottomNavigation from "@/components/BottomNavigation";
import ModeSelector from "@/components/ModeSelector";
import RiderDashboard from "@/pages/RiderDashboard";
import DriverDashboard from "@/pages/DriverDashboard";
import DriverOwnership from "@/pages/DriverOwnership";
import RideHistory from "@/pages/RideHistory";
import RatingsPage from "@/pages/RatingsPage";
import { PaymentsPage } from "@/pages/PaymentsPage";
import Profile from "@/pages/Profile";
import AIAssistant from "@/pages/AIAssistant";
import { Shield } from "lucide-react";

export default function Home() {
  const { user } = useAuth();
  const [currentMode, setCurrentMode] = useState<"rider" | "driver">("rider");
  const [activeTab, setActiveTab] = useState("home");
  const [, setLocation] = useLocation();

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
      case "assistant":
        return <AIAssistant />;
      case "ratings":
        return <RatingsPage />;
      case "payments":
        return <PaymentsPage />;
      case "ownership":
        return <DriverOwnership />;
      case "profile":
        return <Profile />;
      default:
        return currentMode === "rider" ? <RiderDashboard /> : <DriverDashboard />;
    }
  };

  return (
    <div className="min-h-screen bg-background max-w-[430px] mx-auto relative">
      {(user?.isAdmin || user?.isSuperAdmin) && (
        <button
          onClick={() => setLocation("/admin")}
          className="fixed top-2 right-2 z-50 flex items-center gap-1 px-3 py-1.5 bg-primary text-primary-foreground rounded-full text-xs font-medium shadow-lg hover:opacity-90 transition-opacity"
          data-testid="btn-admin-panel"
        >
          <Shield className="w-3 h-3" />
          Admin
        </button>
      )}

      {activeTab === "home" && (
        <ModeSelector 
          currentMode={currentMode} 
          onModeChange={handleModeChange} 
        />
      )}
      
      {currentMode === "driver" && user?.isDriver && activeTab === "home" && (
        <div className="px-4 pb-2">
          <button
            onClick={() => setActiveTab("ownership")}
            className="w-full flex items-center justify-center gap-2 py-2 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800 hover:bg-yellow-100 transition-colors"
            data-testid="btn-driver-ownership"
          >
            <Shield className="w-4 h-4" />
            View Your Ownership Progress
          </button>
        </div>
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
