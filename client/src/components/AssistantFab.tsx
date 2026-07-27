import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { Bot } from "lucide-react";

/**
 * Floating "ask the assistant" button, mounted once at the app root so it
 * shows up on every screen — not just the Assistant tab inside Home. Home
 * (the tab-shell at "/") owns the actual chat UI; this button just gets the
 * user there from wherever they are:
 *  - Already on "/": dispatch pgride:open-assistant (Home is listening,
 *    switches tabs instantly, no navigation).
 *  - Anywhere else (/ratings, /card-setup, /admin, ...): stash a pending-tab
 *    flag in sessionStorage and navigate to "/" — Home reads it on mount.
 * Hidden for logged-out users, while the assistant tab is already open, and
 * while a booking flow is in progress (search/drivers/confirm panels), so it
 * never floats over the destination search or the Confirm Ride button.
 */
export function AssistantFab() {
  const { user } = useAuth();
  const [location, setLocation] = useLocation();
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [bookingActive, setBookingActive] = useState(false);

  useEffect(() => {
    const onTabChanged = (e: Event) => {
      setAssistantOpen((e as CustomEvent).detail?.tab === "assistant");
    };
    // RiderDashboard broadcasts its booking-panel state so the FAB can get
    // out of the way during search/drivers/confirm.
    const onPanelChanged = (e: Event) => {
      setBookingActive(((e as CustomEvent).detail?.panel ?? "idle") !== "idle");
    };
    window.addEventListener("pgride:tab-changed", onTabChanged);
    window.addEventListener("pgride:rider-panel", onPanelChanged);
    return () => {
      window.removeEventListener("pgride:tab-changed", onTabChanged);
      window.removeEventListener("pgride:rider-panel", onPanelChanged);
    };
  }, []);

  // Home (and its tab state) unmounts on any other route — the assistant
  // can't be "open" and no booking panel can be active there.
  useEffect(() => {
    if (location !== "/") {
      setAssistantOpen(false);
      setBookingActive(false);
    }
  }, [location]);

  if (!user || bookingActive || (location === "/" && assistantOpen)) return null;

  const handleClick = () => {
    if (location === "/") {
      window.dispatchEvent(new CustomEvent("pgride:open-assistant"));
    } else {
      sessionStorage.setItem("pgride:pendingTab", "assistant");
      setLocation("/");
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      // z-[59]: above the rider home's idle bottom sheet (z-[55]) and the
      // bottom nav (z-50) — at the app's default z-40 the sheet painted
      // straight over the FAB on phone-width screens, so it never showed on
      // the one screen riders actually land on. Kept below the full-screen
      // search overlay (z-[60]) as a backstop, though bookingActive already
      // hides it there. The inline `right` pins it inside the centered
      // 430px app column on wider screens instead of the viewport edge.
      className="fixed bottom-36 z-[59] h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:brightness-110 active:scale-95 transition-all"
      style={{ right: "max(1rem, calc((100vw - 430px) / 2 + 1rem))" }}
      aria-label="Ask PG Ride Assistant"
      data-testid="button-assistant-fab"
    >
      <Bot className="h-6 w-6" />
    </button>
  );
}
