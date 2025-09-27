import { apiRequest } from "@/lib/queryClient";

export interface RideRequest {
  pickupLocation: {
    lat: number;
    lng: number;
    address: string;
  };
  destinationLocation: {
    lat: number;
    lng: number;
    address: string;
  };
  pickupInstructions?: string;
  driverId: string;
  estimatedFare: number;
  scheduledAt?: string;
}

export interface RideStatusUpdate {
  status: "pending" | "accepted" | "driver_arriving" | "in_progress" | "completed" | "cancelled";
  location?: {
    lat: number;
    lng: number;
  };
  estimatedArrival?: string;
  message?: string;
}

export class RideService {
  // Create a new ride request
  static async createRide(rideData: RideRequest) {
    const response = await apiRequest('POST', '/api/rides', rideData);
    return response.json();
  }

  // Get ride details by ID
  static async getRide(rideId: string) {
    const response = await apiRequest('GET', `/api/rides/${rideId}`);
    return response.json();
  }

  // Update ride status
  static async updateRide(rideId: string, updates: Partial<RideStatusUpdate>) {
    const response = await apiRequest('PUT', `/api/rides/${rideId}`, updates);
    return response.json();
  }

  // Get user's ride history
  static async getRideHistory(limit?: number) {
    const params = limit ? `?limit=${limit}` : '';
    const response = await apiRequest('GET', `/api/rides${params}`);
    return response.json();
  }

  // Get active rides for user
  static async getActiveRides() {
    const response = await apiRequest('GET', '/api/rides/active');
    return response.json();
  }

  // Get nearby drivers
  static async getNearbyDrivers(location: { lat: number; lng: number }, radius: number = 10) {
    const response = await apiRequest('GET', `/api/rides/nearby-drivers?lat=${location.lat}&lng=${location.lng}&radius=${radius}`);
    return response.json();
  }

  // Cancel a ride
  static async cancelRide(rideId: string, reason?: string) {
    return this.updateRide(rideId, { 
      status: "cancelled",
      message: reason 
    });
  }

  // Accept a ride (for drivers)
  static async acceptRide(rideId: string) {
    return this.updateRide(rideId, { status: "accepted" });
  }

  // Mark driver as arriving
  static async markDriverArriving(rideId: string, estimatedArrival?: string) {
    return this.updateRide(rideId, { 
      status: "driver_arriving",
      estimatedArrival 
    });
  }

  // Start the ride
  static async startRide(rideId: string) {
    return this.updateRide(rideId, { status: "in_progress" });
  }

  // Complete the ride
  static async completeRide(rideId: string, actualFare?: number) {
    const updates: any = { status: "completed" };
    if (actualFare) {
      updates.actualFare = actualFare;
    }
    return this.updateRide(rideId, updates);
  }

  // Submit rating for a ride
  static async submitRating(rideId: string, rating: number, review?: string) {
    const response = await apiRequest('POST', `/api/rides/${rideId}/rating`, {
      rating,
      review
    });
    return response.json();
  }

  // Report an issue with a ride
  static async reportIssue(rideId: string, issueType: string, description: string) {
    const response = await apiRequest('POST', '/api/disputes', {
      rideId,
      issueType,
      description
    });
    return response.json();
  }

  // Get disputes for a ride
  static async getRideDisputes(rideId: string) {
    const response = await apiRequest('GET', `/api/disputes/ride/${rideId}`);
    return response.json();
  }

  // Emergency incident reporting
  static async reportEmergency(incidentType: string, location?: { lat: number; lng: number }, rideId?: string, description?: string) {
    const response = await apiRequest('POST', '/api/emergency', {
      incidentType,
      location,
      rideId,
      description
    });
    return response.json();
  }
}

// Helper functions for ride management
export const RideHelpers = {
  // Calculate distance between two points (Haversine formula)
  calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 3959; // Earth's radius in miles
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
      Math.sin(dLng/2) * Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  },

  // Estimate travel time based on distance
  estimateTravelTime(distanceMiles: number): number {
    // Assume average speed of 25 mph for city driving
    const averageSpeedMph = 25;
    return Math.round((distanceMiles / averageSpeedMph) * 60); // Return minutes
  },

  // Format ride status for display
  formatRideStatus(status: string): string {
    switch (status) {
      case "pending":
        return "Looking for driver";
      case "accepted":
        return "Driver assigned";
      case "driver_arriving":
        return "Driver arriving";
      case "in_progress":
        return "In progress";
      case "completed":
        return "Completed";
      case "cancelled":
        return "Cancelled";
      default:
        return "Unknown";
    }
  },

  // Get status color class
  getStatusColor(status: string): string {
    switch (status) {
      case "pending":
        return "text-yellow-600";
      case "accepted":
      case "driver_arriving":
        return "text-blue-600";
      case "in_progress":
        return "text-purple-600";
      case "completed":
        return "text-green-600";
      case "cancelled":
        return "text-red-600";
      default:
        return "text-gray-600";
    }
  },

  // Check if ride can be cancelled
  canCancelRide(status: string): boolean {
    return ["pending", "accepted", "driver_arriving"].includes(status);
  },

  // Check if ride can be rated
  canRateRide(status: string): boolean {
    return status === "completed";
  }
};
