import { useCallback, useRef } from "react";
import { useAuth } from "./useAuth";

const SESSION_ID = `session_${Date.now()}_${Math.random().toString(36).slice(2)}`;

export function useAnalytics() {
  const { user } = useAuth();
  const pendingEvents = useRef<Array<{ eventType: string; eventCategory: string; eventData?: Record<string, any> }>>([]);
  const flushTimeout = useRef<NodeJS.Timeout | null>(null);

  const flush = useCallback(async () => {
    if (pendingEvents.current.length === 0) return;
    const events = [...pendingEvents.current];
    pendingEvents.current = [];

    for (const event of events) {
      try {
        await fetch("/api/analytics/events", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...event, sessionId: SESSION_ID }),
          credentials: "include",
        });
      } catch {}
    }
  }, []);

  const trackEvent = useCallback(
    (eventType: string, eventCategory: string, eventData?: Record<string, any>) => {
      pendingEvents.current.push({ eventType, eventCategory, eventData });

      if (flushTimeout.current) clearTimeout(flushTimeout.current);
      flushTimeout.current = setTimeout(flush, 1000);
    },
    [flush]
  );

  const trackPageView = useCallback(
    (page: string) => {
      trackEvent("page_view", "navigation", { page });
    },
    [trackEvent]
  );

  const trackRideSearch = useCallback(
    (data?: Record<string, any>) => {
      trackEvent("ride_search", "rides", data);
    },
    [trackEvent]
  );

  const trackRideBooked = useCallback(
    (data?: Record<string, any>) => {
      trackEvent("ride_booked", "rides", data);
    },
    [trackEvent]
  );

  const trackRideCompleted = useCallback(
    (data?: Record<string, any>) => {
      trackEvent("ride_completed", "rides", data);
    },
    [trackEvent]
  );

  const trackFeatureUsed = useCallback(
    (feature: string, data?: Record<string, any>) => {
      trackEvent("feature_used", "engagement", { feature, ...data });
    },
    [trackEvent]
  );

  const trackAiChat = useCallback(
    (data?: Record<string, any>) => {
      trackEvent("ai_chat_message", "ai_assistant", data);
    },
    [trackEvent]
  );

  const trackError = useCallback(
    (error: string, data?: Record<string, any>) => {
      trackEvent("error", "system", { error, ...data });
    },
    [trackEvent]
  );

  return {
    trackEvent,
    trackPageView,
    trackRideSearch,
    trackRideBooked,
    trackRideCompleted,
    trackFeatureUsed,
    trackAiChat,
    trackError,
  };
}
