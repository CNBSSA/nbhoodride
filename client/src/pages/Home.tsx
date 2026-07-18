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
import { WelcomeRiderSheet } from "@/components/WelcomeRiderSheet";
import { Shield } from "lucide-react";

const WELCOME_KEY = "pgride:welcomeSeen";

export default function Home() {
  const { user } = useAuth();
  const [showWelcome, setShowWelcome] = useState(false);
  // Persisted so a reload (browser refresh, PWA relaunch) keeps an online
  // driver on their dashboard instead of silently dropping them back to
  // rider mode, where their active rides/claim board aren't visible.
  const [currentMode, setCurrentMode] = useState<"rider" | "driver">(
    () => (localStorage.getItem("pgride:lastMode") === "driver" ? "driver" : "rider")
  );
  const [activeTab, setActiveTab] = useState("home");
  const [, setLocation] = useLocation();

  // Auto-switch to rider mode if user is not a driver and tries to access driver mode
  useEffect(() => {
    if (currentMode === "driver" && !user?.isDriver) {
      setCurrentMode("rider");
    }
  }, [user?.isDriver, currentMode]);

  useEffect(() => {
    localStorage.setItem("pgride:lastMode", currentMode);
  }, [currentMode]);

  useEffect(() => {
    const openProfile = () => setActiveTab("profile");
    window.addEventListener("pgride:open-profile", openProfile);
    const openAssistant = () => setActiveTab("assistant");
    window.addEventListener("pgride:open-assistant", openAssistant);
    // Rider home no longer renders the ModeSelector bar — the map's "Drive"
    // pill dispatches this to flip into driver mode.
    const switchMode = (e: Event) => {
      const mode = (e as CustomEvent).detail?.mode;
      if (mode === "driver" || mode === "rider") {
        setCurrentMode(mode);
        setActiveTab("home");
      }
    };
    window.addEventListener("pgride:switch-mode", switchMode);
    return () => {
      window.removeEventListener("pgride:open-profile", openProfile);
      window.removeEventListener("pgride:open-assistant", openAssistant);
      window.removeEventListener("pgride:switch-mode", switchMode);
    };
  }, []);

  useEffect(() => {
    if (!user?.isApproved) return;
    if (localStorage.getItem(WELCOME_KEY)) return;
    setShowWelcome(true);
  }, [user?.isApproved, user?.id]);

  const dismissWelcome = () => {
    localStorage.setItem(WELCOME_KEY, "1");
    setShowWelcome(false);
  };

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

  const isRiderHome = activeTab === "home" && currentMode === "rider";

  return (
    <div className="h-[100dvh] bg-background max-w-[430px] mx-auto relative flex flex-col overflow-hidden">
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

      {/* Rider home is a full-bleed map — the mode switch lives as a compact
          "Drive" pill on the map itself. The selector bar only renders on the
          driver dashboard (a list layout where the bar fits naturally). */}
      {activeTab === "home" && currentMode === "driver" && (
        <div className="flex-shrink-0">
          <ModeSelector
            currentMode={currentMode}
            onModeChange={handleModeChange}
          />
        </div>
      )}
      
      {currentMode === "driver" && user?.isDriver && activeTab === "home" && (
        <div className="flex-shrink-0 px-4 pb-2">
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
      
      {/* Rider home: flex-1 with overflow-hidden so full-screen map works */}
      {/* All other tabs: flex-1 with overflow-y-auto; bottom padding covers nav + safe area */}
      <div
        className={isRiderHome ? "flex-1 overflow-hidden relative" : "flex-1 overflow-y-auto"}
        style={!isRiderHome ? { paddingBottom: 'calc(5rem + env(safe-area-inset-bottom, 0px))' } : undefined}
      >
        {renderActiveTab()}
      </div>
      
      <BottomNavigation 
        activeTab={activeTab} 
        onTabChange={setActiveTab}
        currentMode={currentMode}
      />

      <WelcomeRiderSheet
        open={showWelcome && currentMode === "rider"}
        balance={user?.virtualCardBalance ?? "0"}
        promoRidesRemaining={user?.promoRidesRemaining ?? 0}
        onDismiss={dismissWelcome}
        onBook={() => {
          dismissWelcome();
          setActiveTab("home");
          window.dispatchEvent(new CustomEvent("pgride:open-booking"));
        }}
      />
    </div>
  );
}
