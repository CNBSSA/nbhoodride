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
 * Hidden for logged-out users and while the assistant tab is already open.
 */
export function AssistantFab() {
  const { user } = useAuth();
  const [location, setLocation] = useLocation();
  const [assistantOpen, setAssistantOpen] = useState(false);

  useEffect(() => {
    const onTabChanged = (e: Event) => {
      setAssistantOpen((e as CustomEvent).detail?.tab === "assistant");
    };
    window.addEventListener("pgride:tab-changed", onTabChanged);
    return () => window.removeEventListener("pgride:tab-changed", onTabChanged);
  }, []);

  // Home (and its tab state) unmounts on any other route — the assistant
  // can't be "open" there, regardless of the last tab it was on.
  useEffect(() => {
    if (location !== "/") setAssistantOpen(false);
  }, [location]);

  if (!user || (location === "/" && assistantOpen)) return null;

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
      className="fixed bottom-36 right-4 z-40 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:brightness-110 active:scale-95 transition-all"
      aria-label="Ask PG Ride Assistant"
      data-testid="button-assistant-fab"
    >
      <Bot className="h-6 w-6" />
    </button>
  );
}
