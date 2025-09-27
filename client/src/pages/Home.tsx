import { useState } from "react";
import BottomNavigation from "@/components/BottomNavigation";
import RiderDashboard from "@/pages/RiderDashboard";
import DriverDashboard from "@/pages/DriverDashboard";
import RideHistory from "@/pages/RideHistory";
import RatingsPage from "@/pages/RatingsPage";
import { PaymentsPage } from "@/pages/PaymentsPage";
import Profile from "@/pages/Profile";

export default function Home() {
  const [activeTab, setActiveTab] = useState("rider-home");

  const renderActiveTab = () => {
    switch (activeTab) {
      case "rider-home":
        return <RiderDashboard />;
      case "driver-dashboard":
        return <DriverDashboard />;
      case "ride-history":
        return <RideHistory />;
      case "ratings":
        return <RatingsPage />;
      case "payments":
        return <PaymentsPage />;
      case "profile":
        return <Profile />;
      default:
        return <RiderDashboard />;
    }
  };

  return (
    <div className="min-h-screen bg-background max-w-[430px] mx-auto relative">
      <div className="pb-20">
        {renderActiveTab()}
      </div>
      <BottomNavigation activeTab={activeTab} onTabChange={setActiveTab} />
    </div>
  );
}
