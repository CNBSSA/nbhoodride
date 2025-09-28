import { useQuery } from "@tanstack/react-query";

interface User {
  id: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  profileImageUrl?: string;
  phone?: string;
  isDriver: boolean;
  isVerified: boolean;
  rating: string;
  totalRides: number;
  emergencyContact?: string;
  createdAt: string;
  updatedAt: string;
  driverProfile?: {
    id: string;
    isOnline: boolean;
    isVerifiedNeighbor: boolean;
    discountRate: string;
    currentLocation?: { lat: number; lng: number };
  };
}

export function useAuth() {
  const { data: user, isLoading } = useQuery<User>({
    queryKey: ["/api/auth/user"],
    retry: false,
  });

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
  };
}
