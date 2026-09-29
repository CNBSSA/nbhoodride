import { useEffect, useRef, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { reconnectDelayMs } from "@shared/liveLocation";

interface WebSocketMessage {
  type: string;
  [key: string]: any;
}

interface UseWebSocketReturn {
  isConnected: boolean;
  sendMessage: (message: WebSocketMessage) => void;
  lastMessage: WebSocketMessage | null;
}

export function useWebSocket(): UseWebSocketReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);
  const { user, isAuthenticated } = useAuth();
  const ws = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
  const isAuthenticatedRef = useRef(isAuthenticated);
  const userRef = useRef(user);
  const shouldReconnectRef = useRef(false);
  const reconnectAttemptRef = useRef(0);

  isAuthenticatedRef.current = isAuthenticated;
  userRef.current = user;

  const connect = useCallback(() => {
    if (!isAuthenticatedRef.current || !userRef.current) return;

    if (ws.current && (ws.current.readyState === WebSocket.OPEN || ws.current.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    try {
      ws.current = new WebSocket(wsUrl);

      ws.current.onopen = () => {
        console.log("WebSocket connected");
        reconnectAttemptRef.current = 0;
        setIsConnected(true);
        
        const currentUser = userRef.current;
        if (currentUser?.id) {
          ws.current?.send(JSON.stringify({
            type: 'join',
            userId: currentUser.id
          }));
        }
      };

      ws.current.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          setLastMessage(message);
          
          switch (message.type) {
            case 'ride_status_update':
              console.log('Ride status update:', message);
              break;
            case 'driver_location':
              console.log('Driver location update:', message);
              break;
            case 'emergency_alert':
              console.log('Emergency alert:', message);
              break;
            default:
              console.log('Unknown message type:', message.type);
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      ws.current.onclose = () => {
        console.log("WebSocket disconnected");
        setIsConnected(false);
        
        if (shouldReconnectRef.current && isAuthenticatedRef.current) {
          // Back off with jitter (shared/liveLocation.ts): 3 s, 6 s, 12 s,
          // 24 s, then 30 s — a fixed 3 s beat hammered a server that was
          // restarting, and every phone hit it in step.
          reconnectAttemptRef.current += 1;
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, reconnectDelayMs(reconnectAttemptRef.current));
        }
      };

      ws.current.onerror = (error) => {
        console.error("WebSocket error:", error);
        setIsConnected(false);
      };
    } catch (error) {
      console.error("Failed to create WebSocket connection:", error);
    }
  }, []);

  const disconnect = useCallback(() => {
    shouldReconnectRef.current = false;
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.close();
    }
    ws.current = null;
    setIsConnected(false);
  }, []);

  const sendMessage = useCallback((message: WebSocketMessage) => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(message));
    } else {
      console.warn("WebSocket is not connected. Message not sent:", message);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated && user) {
      shouldReconnectRef.current = true;
      connect();
    } else {
      disconnect();
    }

    return () => {
      disconnect();
    };
  }, [isAuthenticated, user?.id, connect, disconnect]);

  return {
    isConnected,
    sendMessage,
    lastMessage,
  };
}

// Convenience hooks for specific WebSocket functionalities
export function useDriverLocationUpdates() {
  const { sendMessage, isConnected } = useWebSocket();

  const updateLocation = (location: { lat: number; lng: number }) => {
    if (isConnected) {
      sendMessage({
        type: 'location_update',
        location,
      });
    }
  };

  return { updateLocation, isConnected };
}

export function useRideStatusUpdates() {
  const { sendMessage, lastMessage, isConnected } = useWebSocket();

  const updateRideStatus = (rideId: string, status: string, targetUserId: string, message?: string) => {
    if (isConnected) {
      sendMessage({
        type: 'ride_status',
        rideId,
        status,
        targetUserId,
        message,
      });
    }
  };

  return { updateRideStatus, lastMessage, isConnected };
}

export function useEmergencyAlert() {
  const { sendMessage, isConnected } = useWebSocket();

  const sendEmergencyAlert = (location: { lat: number; lng: number }, incident: any) => {
    if (isConnected) {
      sendMessage({
        type: 'emergency',
        location,
        incident,
      });
    }
  };

  return { sendEmergencyAlert, isConnected };
}
