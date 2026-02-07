import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";

interface User {
  id: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  profileImageUrl?: string;
  phone?: string;
  isDriver: boolean;
  isVerified: boolean;
  isAdmin: boolean;
  isSuspended: boolean;
  rating: string;
  totalRides: number;
  emergencyContact?: string;
  virtualCardBalance: string;
  stripeCustomerId?: string;
  stripePaymentMethodId?: string;
  createdAt: string;
  updatedAt: string;
  driverProfile?: {
    id: string;
    isOnline: boolean;
    isVerifiedNeighbor: boolean;
    isSuspended: boolean;
    approvalStatus: string;
    discountRate: string;
    currentLocation?: { lat: number; lng: number };
  };
}

export function useAuth() {
  const { data: user, isLoading } = useQuery<User | null>({
    queryKey: ["/api/auth/user"],
    queryFn: getQueryFn<User | null>({ on401: "returnNull" }),
    retry: false,
  });

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
  };
}
