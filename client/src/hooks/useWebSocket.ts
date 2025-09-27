import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/useAuth";

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

  const connect = () => {
    if (!isAuthenticated || !user) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    try {
      ws.current = new WebSocket(wsUrl);

      ws.current.onopen = () => {
        console.log("WebSocket connected");
        setIsConnected(true);
        
        // Join with user ID for targeted messaging
        if (user?.id) {
          ws.current?.send(JSON.stringify({
            type: 'join',
            userId: user.id
          }));
        }
      };

      ws.current.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          setLastMessage(message);
          
          // Handle different message types
          switch (message.type) {
            case 'ride_status_update':
              // Handle ride status updates (driver accepted, arriving, etc.)
              console.log('Ride status update:', message);
              break;
            case 'driver_location':
              // Handle real-time driver location updates
              console.log('Driver location update:', message);
              break;
            case 'emergency_alert':
              // Handle emergency alerts
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
        
        // Attempt to reconnect after 3 seconds if user is still authenticated
        if (isAuthenticated) {
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, 3000);
        }
      };

      ws.current.onerror = (error) => {
        console.error("WebSocket error:", error);
        setIsConnected(false);
      };
    } catch (error) {
      console.error("Failed to create WebSocket connection:", error);
    }
  };

  const disconnect = () => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.close();
    }
    ws.current = null;
    setIsConnected(false);
  };

  const sendMessage = (message: WebSocketMessage) => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(message));
    } else {
      console.warn("WebSocket is not connected. Message not sent:", message);
    }
  };

  useEffect(() => {
    if (isAuthenticated && user) {
      connect();
    } else {
      disconnect();
    }

    return () => {
      disconnect();
    };
  }, [isAuthenticated, user]);

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
