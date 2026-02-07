import {
  users,
  driverProfiles,
  vehicles,
  rides,
  disputes,
  emergencyIncidents,
  driverWeeklyHours,
  driverOwnership,
  shareCertificates,
  ownershipRebalanceLog,
  profitDeclarations,
  profitDistributions,
  adminActivityLog,
  type User,
  type UpsertUser,
  type DriverProfile,
  type Vehicle,
  type Ride,
  type Dispute,
  type EmergencyIncident,
  type DriverWeeklyHours,
  type DriverOwnership,
  type ShareCertificate,
  type ProfitDeclaration,
  type ProfitDistribution,
  type AdminActivityLog,
  type InsertDriverProfile,
  type InsertVehicle,
  type InsertRide,
  type InsertDispute,
  type InsertEmergencyIncident,
} from "@shared/schema";
import { db } from "./db";
import { eq, and, desc, asc, sql, or, isNotNull, gt, like, inArray, count, sum, gte, lte } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3959; // Earth's radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function estimateRideDurationMinutes(ride: any): number {
  const pickup = ride.pickupLocation as { lat: number; lng: number } | null;
  const dest = ride.destinationLocation as { lat: number; lng: number } | null;
  if (!pickup || !dest) return 30;
  const distMiles = haversineDistance(pickup.lat, pickup.lng, dest.lat, dest.lng);
  const avgSpeedMph = 25;
  return Math.max(5, (distMiles / avgSpeedMph) * 60);
}

async function filterAvailableDrivers(
  drivers: any[],
  getUserId: (driver: any) => string
): Promise<any[]> {
  const driverUserIds = drivers.map(getUserId).filter(Boolean);
  if (driverUserIds.length === 0) return [];

  const activeStatuses = ['accepted', 'driver_arriving', 'in_progress'] as const;
  const activeRidesForDrivers = await db
    .select()
    .from(rides)
    .where(
      and(
        inArray(rides.driverId, driverUserIds),
        inArray(rides.status, [...activeStatuses])
      )
    );

  const ridesByDriver = new Map<string, typeof activeRidesForDrivers>();
  for (const ride of activeRidesForDrivers) {
    if (!ride.driverId) continue;
    if (!ridesByDriver.has(ride.driverId)) {
      ridesByDriver.set(ride.driverId, []);
    }
    ridesByDriver.get(ride.driverId)!.push(ride);
  }

  return drivers.filter(driver => {
    const userId = getUserId(driver);
    const driverRides = ridesByDriver.get(userId);

    if (!driverRides || driverRides.length === 0) {
      return true;
    }

    // Driver is unavailable if they have any ride in 'accepted' or 'driver_arriving' status
    // (committed to a rider but ride hasn't started yet)
    const hasPreStartRide = driverRides.some(
      r => r.status === 'accepted' || r.status === 'driver_arriving'
    );
    if (hasPreStartRide) {
      return false;
    }

    // For in_progress rides, check if ALL have ≤5 minutes remaining
    const inProgressRides = driverRides.filter(r => r.status === 'in_progress');
    if (inProgressRides.length === 0) {
      return true;
    }

    return inProgressRides.every(ride => {
      if (!ride.startedAt) return false;
      const estimatedMinutes = estimateRideDurationMinutes(ride);
      const elapsedMinutes = (Date.now() - new Date(ride.startedAt).getTime()) / 60000;
      const remainingMinutes = estimatedMinutes - elapsedMinutes;
      return remainingMinutes <= 5;
    });
  });
}

export interface IStorage {
  // User operations (required for Replit Auth)
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: UpsertUser): Promise<User>;
  upsertUser(user: UpsertUser): Promise<User>;
  updatePassword(userId: string, hashedPassword: string): Promise<void>;
  setPasswordResetToken(email: string, token: string, expiry: Date): Promise<void>;
  getUserByResetToken(token: string): Promise<User | undefined>;
  
  // Driver operations
  createDriverProfile(profile: InsertDriverProfile): Promise<DriverProfile>;
  getDriverProfile(userId: string): Promise<DriverProfile | undefined>;
  updateDriverProfile(userId: string, updates: Partial<InsertDriverProfile>): Promise<DriverProfile>;
  updateDriverLocation(userId: string, location: {lat: number, lng: number}): Promise<void>;
  toggleDriverOnlineStatus(userId: string, isOnline: boolean): Promise<void>;
  getNearbyDrivers(location: {lat: number, lng: number}, radiusKm: number): Promise<(DriverProfile & {user: User, vehicles: Vehicle[]})[]>;
  searchDriversByPhone(phone: string): Promise<(DriverProfile & {user: User, vehicles: Vehicle[]})[]>;
  
  // Vehicle operations
  createVehicle(vehicle: InsertVehicle): Promise<Vehicle>;
  getVehiclesByDriverId(driverProfileId: string): Promise<Vehicle[]>;
  updateVehicle(vehicleId: string, updates: Partial<InsertVehicle>): Promise<Vehicle>;
  
  // Ride operations
  createRide(ride: InsertRide): Promise<Ride>;
  getRide(rideId: string): Promise<Ride | undefined>;
  updateRide(rideId: string, updates: Partial<InsertRide>): Promise<Ride>;
  getRidesByUser(userId: string, limit?: number): Promise<Ride[]>;
  getActiveRides(userId: string): Promise<Ride[]>;
  getScheduledRides(userId: string): Promise<Ride[]>;
  
  // Rating operations
  updateRideRating(rideId: string, raterId: string, rating: number, review?: string): Promise<void>;
  getRidesForRating(userId: string): Promise<any[]>;
  updateUserRating(userId: string): Promise<void>;
  
  // Payment operations
  confirmCashPayment(rideId: string, confirmerId: string, tipAmount?: number): Promise<Ride>;
  getRidesAwaitingPayment(userId: string): Promise<any[]>;
  updateUserStripeInfo(userId: string, stripeCustomerId?: string, stripePaymentMethodId?: string): Promise<User>;
  setRidePaymentAuthorization(rideId: string, paymentIntentId: string): Promise<Ride>;
  captureRidePayment(rideId: string, capturedAmount?: number, tipAmount?: number): Promise<Ride>;
  cancelRideWithFee(rideId: string, cancellationFee: number, reason: string, traveledDistance?: number, traveledTime?: number): Promise<Ride>;
  
  // Virtual card operations
  deductVirtualCardBalance(userId: string, amount: number): Promise<User>;
  addVirtualCardBalance(userId: string, amount: number): Promise<User>;
  getVirtualCardBalance(userId: string): Promise<number>;
  
  // Dispute operations
  createDispute(dispute: InsertDispute): Promise<Dispute>;
  getDisputesByRide(rideId: string): Promise<Dispute[]>;
  updateDispute(disputeId: string, updates: Partial<InsertDispute>): Promise<Dispute>;
  
  // Emergency operations
  createEmergencyIncident(incident: InsertEmergencyIncident): Promise<EmergencyIncident>;
  createEmergencyIncidentWithSharing(incident: InsertEmergencyIncident): Promise<EmergencyIncident>;
  getActiveEmergencyIncidents(): Promise<EmergencyIncident[]>;
  getEmergencyIncidentByToken(token: string): Promise<EmergencyIncident | null>;
  updateEmergencyIncident(incidentId: string, updates: Partial<InsertEmergencyIncident>): Promise<EmergencyIncident>;
  updateUserEmergencyContact(userId: string, phone: string): Promise<User>;
  
  // Earnings operations
  getDriverEarnings(driverId: string, period: 'today' | 'week' | 'month'): Promise<{fare: number, tips: number, total: number, rideCount: number}>;
  getDriverRides(driverId: string, period: 'today' | 'week' | 'month'): Promise<Ride[]>;
  
  // Driver ride management operations
  getPendingRidesForDriver(driverId: string): Promise<any[]>;
  acceptRide(rideId: string, driverId: string): Promise<Ride>;
  declineRide(rideId: string, driverId: string): Promise<void>;
  startRide(rideId: string, driverId: string): Promise<Ride>;
  completeRide(rideId: string, driverId: string, actualFare?: number): Promise<Ride>;
  getActiveRidesForDriver(driverId: string): Promise<any[]>;
  
  // GPS tracking operations
  addRouteWaypoint(rideId: string, driverId: string, waypoint: {lat: number, lng: number}): Promise<void>;
  calculateActualDistance(routePath: Array<{lat: number, lng: number, timestamp: number}>): number;
  getRideStats(rideId: string, userId?: string): Promise<{distance: number, duration: number, estimatedFare: number}>;
}

export class DatabaseStorage implements IStorage {
  // User operations
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async createUser(userData: UpsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(userData)
      .returning();
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    // First check if user already exists by ID
    if (userData.id) {
      const existingUser = await this.getUser(userData.id);
      if (existingUser) {
        // Update existing user
        const [user] = await db
          .update(users)
          .set({
            ...userData,
            updatedAt: new Date(),
          })
          .where(eq(users.id, userData.id))
          .returning();
        return user;
      }
    }
    
    // Insert new user
    const [user] = await db
      .insert(users)
      .values(userData)
      .returning();
    return user;
  }

  async updatePassword(userId: string, hashedPassword: string): Promise<void> {
    await db
      .update(users)
      .set({ 
        password: hashedPassword,
        passwordResetToken: null,
        passwordResetExpiry: null,
        updatedAt: new Date() 
      })
      .where(eq(users.id, userId));
  }

  async setPasswordResetToken(email: string, token: string, expiry: Date): Promise<void> {
    await db
      .update(users)
      .set({ 
        passwordResetToken: token,
        passwordResetExpiry: expiry,
        updatedAt: new Date() 
      })
      .where(eq(users.email, email));
  }

  async getUserByResetToken(token: string): Promise<User | undefined> {
    const [user] = await db
      .select()
      .from(users)
      .where(
        and(
          eq(users.passwordResetToken, token),
          sql`${users.passwordResetExpiry} > NOW()`
        )
      );
    return user;
  }

  // Driver operations
  async createDriverProfile(profile: InsertDriverProfile): Promise<DriverProfile> {
    const [driverProfile] = await db
      .insert(driverProfiles)
      .values(profile)
      .returning();
    return driverProfile;
  }

  async getDriverProfile(userId: string): Promise<DriverProfile | undefined> {
    const [profile] = await db
      .select()
      .from(driverProfiles)
      .where(eq(driverProfiles.userId, userId));
    return profile;
  }

  async updateDriverProfile(userId: string, updates: Partial<InsertDriverProfile>): Promise<DriverProfile> {
    const [profile] = await db
      .update(driverProfiles)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(driverProfiles.userId, userId))
      .returning();
    return profile;
  }

  async updateDriverLocation(userId: string, location: {lat: number, lng: number}): Promise<void> {
    await db
      .update(driverProfiles)
      .set({ 
        currentLocation: location,
        updatedAt: new Date() 
      })
      .where(eq(driverProfiles.userId, userId));
  }

  async toggleDriverOnlineStatus(userId: string, isOnline: boolean): Promise<void> {
    await db
      .update(driverProfiles)
      .set({ 
        isOnline,
        updatedAt: new Date() 
      })
      .where(eq(driverProfiles.userId, userId));
  }

  async getNearbyDrivers(location: {lat: number, lng: number}, radiusKm: number): Promise<(DriverProfile & {user: User, vehicles: Vehicle[]})[]> {
    const results = await db
      .select()
      .from(driverProfiles)
      .innerJoin(users, eq(driverProfiles.userId, users.id))
      .leftJoin(vehicles, eq(vehicles.driverProfileId, driverProfiles.id))
      .where(eq(driverProfiles.isOnline, true));

    const driversMap = new Map();
    for (const result of results) {
      const driverId = result.driver_profiles.id;
      if (!driversMap.has(driverId)) {
        driversMap.set(driverId, {
          ...result.driver_profiles,
          user: result.users,
          vehicles: []
        });
      }
      if (result.vehicles) {
        driversMap.get(driverId).vehicles.push(result.vehicles);
      }
    }

    const allDrivers = Array.from(driversMap.values());

    return filterAvailableDrivers(allDrivers, (d) => d.userId);
  }

  async searchDriversByPhone(phone: string): Promise<(DriverProfile & {user: User, vehicles: Vehicle[]})[]> {
    // Normalize phone number by removing all non-numeric characters
    const normalizedPhone = phone.replace(/\D/g, '');
    
    // Search for drivers with matching phone number
    // Use LIKE pattern matching which is safe with parameter binding
    const results = await db
      .select()
      .from(driverProfiles)
      .innerJoin(users, eq(driverProfiles.userId, users.id))
      .leftJoin(vehicles, eq(vehicles.driverProfileId, driverProfiles.id))
      .where(
        and(
          eq(users.isDriver, true),
          like(users.phone, `%${normalizedPhone}%`)
        )
      );

    const driversMap = new Map();
    for (const result of results) {
      const driverId = result.driver_profiles.id;
      if (!driversMap.has(driverId)) {
        driversMap.set(driverId, {
          ...result.driver_profiles,
          user: result.users,
          vehicles: []
        });
      }
      if (result.vehicles) {
        driversMap.get(driverId).vehicles.push(result.vehicles);
      }
    }

    const allDrivers = Array.from(driversMap.values());

    return filterAvailableDrivers(allDrivers, (d) => d.userId);
  }

  // Vehicle operations
  async createVehicle(vehicle: InsertVehicle): Promise<Vehicle> {
    const [newVehicle] = await db
      .insert(vehicles)
      .values([vehicle as any])
      .returning();
    return newVehicle;
  }

  async getVehiclesByDriverId(driverProfileId: string): Promise<Vehicle[]> {
    return await db
      .select()
      .from(vehicles)
      .where(eq(vehicles.driverProfileId, driverProfileId));
  }

  async updateVehicle(vehicleId: string, updates: Partial<InsertVehicle>): Promise<Vehicle> {
    const [vehicle] = await db
      .update(vehicles)
      .set({ 
        ...updates,
        updatedAt: new Date(),
        photos: updates.photos as string[] || []
      })
      .where(eq(vehicles.id, vehicleId))
      .returning();
    return vehicle;
  }

  // Ride operations
  async createRide(ride: InsertRide): Promise<Ride> {
    const [newRide] = await db
      .insert(rides)
      .values(ride as any)
      .returning();
    return newRide;
  }

  async getRide(rideId: string): Promise<Ride | undefined> {
    const [ride] = await db
      .select()
      .from(rides)
      .where(eq(rides.id, rideId));
    return ride;
  }

  async updateRide(rideId: string, updates: Partial<InsertRide>): Promise<Ride> {
    const [ride] = await db
      .update(rides)
      .set({ ...updates, updatedAt: new Date() } as any)
      .where(eq(rides.id, rideId))
      .returning();
    return ride;
  }

  async getRidesByUser(userId: string, limit = 50): Promise<Ride[]> {
    return await db
      .select()
      .from(rides)
      .where(or(eq(rides.riderId, userId), eq(rides.driverId, userId)))
      .orderBy(desc(rides.createdAt))
      .limit(limit);
  }

  async getActiveRides(userId: string): Promise<Ride[]> {
    return await db
      .select()
      .from(rides)
      .where(
        and(
          or(eq(rides.riderId, userId), eq(rides.driverId, userId)),
          or(
            eq(rides.status, "pending"),
            eq(rides.status, "accepted"),
            eq(rides.status, "driver_arriving"),
            eq(rides.status, "in_progress")
          )
        )
      )
      .orderBy(desc(rides.createdAt));
  }

  async getScheduledRides(userId: string): Promise<Ride[]> {
    return await db
      .select()
      .from(rides)
      .where(
        and(
          eq(rides.riderId, userId),
          eq(rides.status, "pending"),
          isNotNull(rides.scheduledAt),
          gt(rides.scheduledAt, sql`now()`)
        )
      )
      .orderBy(asc(rides.scheduledAt));
  }

  // Rating operations
  async updateRideRating(rideId: string, raterId: string, rating: number, review?: string): Promise<void> {
    const ride = await this.getRide(rideId);
    if (!ride) throw new Error("Ride not found");

    if (ride.riderId === raterId) {
      await db
        .update(rides)
        .set({ 
          driverRating: rating,
          driverReview: review,
          updatedAt: new Date()
        })
        .where(eq(rides.id, rideId));
    } else if (ride.driverId === raterId) {
      await db
        .update(rides)
        .set({ 
          riderRating: rating,
          riderReview: review,
          updatedAt: new Date()
        })
        .where(eq(rides.id, rideId));
    }
  }

  // Dispute operations
  async createDispute(dispute: InsertDispute): Promise<Dispute> {
    const [newDispute] = await db
      .insert(disputes)
      .values(dispute)
      .returning();
    return newDispute;
  }

  async getDisputesByRide(rideId: string): Promise<Dispute[]> {
    return await db
      .select()
      .from(disputes)
      .where(eq(disputes.rideId, rideId))
      .orderBy(desc(disputes.createdAt));
  }

  async updateDispute(disputeId: string, updates: Partial<InsertDispute>): Promise<Dispute> {
    const [dispute] = await db
      .update(disputes)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(disputes.id, disputeId))
      .returning();
    return dispute;
  }

  // Emergency operations
  async createEmergencyIncident(incident: InsertEmergencyIncident): Promise<EmergencyIncident> {
    const [newIncident] = await db
      .insert(emergencyIncidents)
      .values(incident)
      .returning();
    return newIncident;
  }

  async getActiveEmergencyIncidents(): Promise<EmergencyIncident[]> {
    return await db
      .select()
      .from(emergencyIncidents)
      .where(eq(emergencyIncidents.status, "active"))
      .orderBy(desc(emergencyIncidents.createdAt));
  }

  async updateEmergencyIncident(incidentId: string, updates: Partial<InsertEmergencyIncident>): Promise<EmergencyIncident> {
    const [incident] = await db
      .update(emergencyIncidents)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(emergencyIncidents.id, incidentId))
      .returning();
    return incident;
  }

  // Emergency contact management
  async updateUserEmergencyContact(userId: string, emergencyContact: string): Promise<User> {
    const [user] = await db
      .update(users)
      .set({ emergencyContact, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    return user;
  }

  // Enhanced emergency incident with location sharing
  async createEmergencyIncidentWithSharing(incident: InsertEmergencyIncident & { shareToken: string }): Promise<EmergencyIncident> {
    const [newIncident] = await db
      .insert(emergencyIncidents)
      .values(incident)
      .returning();
    return newIncident;
  }

  async getEmergencyIncidentByToken(shareToken: string): Promise<EmergencyIncident | null> {
    const [incident] = await db
      .select()
      .from(emergencyIncidents)
      .where(eq(emergencyIncidents.shareToken, shareToken))
      .limit(1);
    return incident || null;
  }

  async updateEmergencyIncidentLocation(incidentId: string, location: { lat: number, lng: number }): Promise<EmergencyIncident> {
    const [incident] = await db
      .update(emergencyIncidents)
      .set({ 
        location, 
        lastLocationUpdate: new Date(),
        updatedAt: new Date() 
      })
      .where(eq(emergencyIncidents.id, incidentId))
      .returning();
    return incident;
  }

  // Earnings operations
  async getDriverEarnings(driverId: string, period: 'today' | 'week' | 'month'): Promise<{fare: number, tips: number, total: number, rideCount: number}> {
    const now = new Date();
    let startDate: Date;
    
    switch (period) {
      case 'today':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case 'week':
        const weekStart = now.getDate() - now.getDay();
        startDate = new Date(now.getFullYear(), now.getMonth(), weekStart);
        break;
      case 'month':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
    }

    const completedRides = await db
      .select()
      .from(rides)
      .where(
        and(
          eq(rides.driverId, driverId),
          eq(rides.status, "completed"),
          sql`${rides.completedAt} >= ${startDate.toISOString()}`
        )
      );

    const fare = completedRides.reduce((sum, ride) => sum + parseFloat(ride.actualFare?.toString() || '0'), 0);
    const tips = completedRides.reduce((sum, ride) => sum + parseFloat(ride.tipAmount?.toString() || '0'), 0);

    return {
      fare,
      tips,
      total: fare + tips,
      rideCount: completedRides.length
    };
  }

  async getDriverRides(driverId: string, period: 'today' | 'week' | 'month'): Promise<Ride[]> {
    const now = new Date();
    let startDate: Date;
    
    switch (period) {
      case 'today':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case 'week':
        const weekStart = now.getDate() - now.getDay();
        startDate = new Date(now.getFullYear(), now.getMonth(), weekStart);
        break;
      case 'month':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
    }

    return await db
      .select()
      .from(rides)
      .where(
        and(
          eq(rides.driverId, driverId),
          eq(rides.status, "completed"),
          sql`${rides.completedAt} >= ${startDate.toISOString()}`
        )
      )
      .orderBy(desc(rides.completedAt));
  }

  // Driver ride management operations
  async getPendingRidesForDriver(driverId: string): Promise<any[]> {
    return await db
      .select({
        id: rides.id,
        riderId: rides.riderId,
        driverId: rides.driverId,
        pickupLocation: rides.pickupLocation,
        destinationLocation: rides.destinationLocation,
        pickupInstructions: rides.pickupInstructions,
        status: rides.status,
        paymentMethod: rides.paymentMethod,
        estimatedFare: rides.estimatedFare,
        actualFare: rides.actualFare,
        distance: rides.distance,
        duration: rides.duration,
        tipAmount: rides.tipAmount,
        paymentStatus: rides.paymentStatus,
        stripePaymentIntentId: rides.stripePaymentIntentId,
        refundedAmount: rides.refundedAmount,
        cancellationFee: rides.cancellationFee,
        cancellationReason: rides.cancellationReason,
        driverTraveledDistance: rides.driverTraveledDistance,
        driverTraveledTime: rides.driverTraveledTime,
        routePath: rides.routePath,
        cashReceivedAt: rides.cashReceivedAt,
        paidBy: rides.paidBy,
        riderRating: rides.riderRating,
        driverRating: rides.driverRating,
        riderReview: rides.riderReview,
        driverReview: rides.driverReview,
        scheduledAt: rides.scheduledAt,
        acceptedAt: rides.acceptedAt,
        startedAt: rides.startedAt,
        completedAt: rides.completedAt,
        createdAt: rides.createdAt,
        updatedAt: rides.updatedAt,
        rider: {
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          rating: users.rating,
          profileImageUrl: users.profileImageUrl
        }
      })
      .from(rides)
      .leftJoin(users, eq(rides.riderId, users.id))
      .where(
        and(
          eq(rides.driverId, driverId),
          eq(rides.status, "pending")
        )
      )
      .orderBy(desc(rides.createdAt));
  }

  async acceptRide(rideId: string, driverId: string): Promise<Ride> {
    // Verify the ride belongs to this driver and is still pending
    const ride = await this.getRide(rideId);
    if (!ride) {
      throw new Error("Ride not found");
    }
    if (ride.driverId !== driverId) {
      throw new Error("Unauthorized to accept this ride");
    }
    if (ride.status !== "pending") {
      throw new Error("Ride is no longer available");
    }

    // Update ride status to accepted
    const [updatedRide] = await db
      .update(rides)
      .set({ 
        status: "accepted",
        acceptedAt: new Date(),
        updatedAt: new Date()
      })
      .where(eq(rides.id, rideId))
      .returning();
    
    return updatedRide;
  }

  async declineRide(rideId: string, driverId: string): Promise<void> {
    // Verify the ride belongs to this driver and is still pending
    const ride = await this.getRide(rideId);
    if (!ride) {
      throw new Error("Ride not found");
    }
    if (ride.driverId !== driverId) {
      throw new Error("Unauthorized to decline this ride");
    }
    if (ride.status !== "pending") {
      throw new Error("Ride is no longer available");
    }

    // For now, we'll just mark as cancelled. In production, you might want to 
    // reassign to another driver or set status to "declined" and find another driver
    await db
      .update(rides)
      .set({ 
        status: "cancelled",
        updatedAt: new Date()
      })
      .where(eq(rides.id, rideId));
  }

  async startRide(rideId: string, driverId: string): Promise<Ride> {
    // Verify the ride belongs to this driver and is accepted
    const ride = await this.getRide(rideId);
    if (!ride) {
      throw new Error("Ride not found");
    }
    if (ride.driverId !== driverId) {
      throw new Error("Unauthorized to start this ride");
    }
    if (ride.status !== "accepted") {
      throw new Error("Ride cannot be started. Current status: " + ride.status);
    }

    // Update ride status to in_progress
    const [updatedRide] = await db
      .update(rides)
      .set({ 
        status: "in_progress",
        startedAt: new Date(),
        updatedAt: new Date()
      })
      .where(eq(rides.id, rideId))
      .returning();
    
    return updatedRide;
  }

  async completeRide(rideId: string, driverId: string, actualFare?: number): Promise<Ride> {
    // Verify the ride belongs to this driver and is in progress
    const ride = await this.getRide(rideId);
    if (!ride) {
      throw new Error("Ride not found");
    }
    if (ride.driverId !== driverId) {
      throw new Error("Unauthorized to complete this ride");
    }
    if (ride.status !== "in_progress") {
      throw new Error("Ride cannot be completed. Current status: " + ride.status);
    }

    const completedAt = new Date();
    const updateData: any = { 
      status: "completed",
      completedAt,
      updatedAt: new Date()
    };
    
    // Calculate actual distance and time from GPS tracking
    const routePath = (ride.routePath as Array<{lat: number, lng: number, timestamp: number}>) || [];
    let calculatedFare = actualFare;
    
    if (routePath.length >= 2 && ride.startedAt) {
      // Calculate actual distance from GPS waypoints
      const actualDistance = this.calculateActualDistance(routePath);
      updateData.driverTraveledDistance = actualDistance.toFixed(2);
      
      // Calculate actual duration in minutes
      const startTime = new Date(ride.startedAt).getTime();
      const endTime = completedAt.getTime();
      const durationMinutes = Math.round((endTime - startTime) / (1000 * 60));
      updateData.driverTraveledTime = durationMinutes;
      
      // Calculate fare using PG County rates if not manually overridden
      if (actualFare === undefined) {
        // PG County rates: $18/hour + $1.50/mile
        const timeRatePerHour = 18;
        const mileRate = 1.50;
        const minimumFare = 5.00;
        const maximumFare = 100.00;
        
        const durationHours = durationMinutes / 60;
        const timeCharge = timeRatePerHour * durationHours;
        const distanceCharge = mileRate * actualDistance;
        let fareAmount = timeCharge + distanceCharge;
        
        // Apply min/max limits
        fareAmount = Math.max(minimumFare, Math.min(maximumFare, fareAmount));
        
        calculatedFare = Math.round(fareAmount * 100) / 100; // Round to 2 decimals
      }
    }
    
    // Use calculated fare or fallback to estimated fare
    if (calculatedFare !== undefined) {
      updateData.actualFare = calculatedFare.toString();
    } else if (!ride.actualFare) {
      // If no GPS data and no fare provided, use estimated fare
      updateData.actualFare = ride.estimatedFare;
    }

    // Update ride status to completed
    const [updatedRide] = await db
      .update(rides)
      .set(updateData)
      .where(eq(rides.id, rideId))
      .returning();
    
    return updatedRide;
  }

  async getActiveRidesForDriver(driverId: string): Promise<any[]> {
    return await db
      .select({
        id: rides.id,
        riderId: rides.riderId,
        driverId: rides.driverId,
        pickupLocation: rides.pickupLocation,
        destinationLocation: rides.destinationLocation,
        pickupInstructions: rides.pickupInstructions,
        status: rides.status,
        paymentMethod: rides.paymentMethod,
        estimatedFare: rides.estimatedFare,
        actualFare: rides.actualFare,
        distance: rides.distance,
        duration: rides.duration,
        tipAmount: rides.tipAmount,
        paymentStatus: rides.paymentStatus,
        stripePaymentIntentId: rides.stripePaymentIntentId,
        refundedAmount: rides.refundedAmount,
        cancellationFee: rides.cancellationFee,
        cancellationReason: rides.cancellationReason,
        driverTraveledDistance: rides.driverTraveledDistance,
        driverTraveledTime: rides.driverTraveledTime,
        routePath: rides.routePath,
        cashReceivedAt: rides.cashReceivedAt,
        paidBy: rides.paidBy,
        riderRating: rides.riderRating,
        driverRating: rides.driverRating,
        riderReview: rides.riderReview,
        driverReview: rides.driverReview,
        scheduledAt: rides.scheduledAt,
        acceptedAt: rides.acceptedAt,
        startedAt: rides.startedAt,
        completedAt: rides.completedAt,
        createdAt: rides.createdAt,
        updatedAt: rides.updatedAt,
        rider: {
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          rating: users.rating,
          profileImageUrl: users.profileImageUrl
        }
      })
      .from(rides)
      .leftJoin(users, eq(rides.riderId, users.id))
      .where(
        and(
          eq(rides.driverId, driverId),
          or(
            eq(rides.status, "accepted"),
            eq(rides.status, "in_progress")
          )
        )
      )
      .orderBy(desc(rides.createdAt));
  }

  async getRidesForRating(userId: string): Promise<any[]> {
    const driverUsers = alias(users, "driverUsers");
    
    return await db
      .select({
        id: rides.id,
        riderId: rides.riderId,
        driverId: rides.driverId,
        pickupLocation: rides.pickupLocation,
        destinationLocation: rides.destinationLocation,
        pickupInstructions: rides.pickupInstructions,
        status: rides.status,
        paymentMethod: rides.paymentMethod,
        estimatedFare: rides.estimatedFare,
        actualFare: rides.actualFare,
        distance: rides.distance,
        duration: rides.duration,
        tipAmount: rides.tipAmount,
        paymentStatus: rides.paymentStatus,
        stripePaymentIntentId: rides.stripePaymentIntentId,
        refundedAmount: rides.refundedAmount,
        cancellationFee: rides.cancellationFee,
        cancellationReason: rides.cancellationReason,
        driverTraveledDistance: rides.driverTraveledDistance,
        driverTraveledTime: rides.driverTraveledTime,
        routePath: rides.routePath,
        cashReceivedAt: rides.cashReceivedAt,
        paidBy: rides.paidBy,
        riderRating: rides.riderRating,
        driverRating: rides.driverRating,
        riderReview: rides.riderReview,
        driverReview: rides.driverReview,
        scheduledAt: rides.scheduledAt,
        acceptedAt: rides.acceptedAt,
        startedAt: rides.startedAt,
        completedAt: rides.completedAt,
        createdAt: rides.createdAt,
        updatedAt: rides.updatedAt,
        rider: {
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          rating: users.rating,
          profileImageUrl: users.profileImageUrl
        },
        driver: {
          id: driverUsers.id,
          firstName: driverUsers.firstName,
          lastName: driverUsers.lastName,
          rating: driverUsers.rating,
          profileImageUrl: driverUsers.profileImageUrl
        }
      })
      .from(rides)
      .leftJoin(users, eq(rides.riderId, users.id))
      .leftJoin(driverUsers, eq(rides.driverId, driverUsers.id))
      .where(
        and(
          eq(rides.status, "completed"),
          or(
            // User is rider and hasn't rated driver yet
            and(
              eq(rides.riderId, userId),
              sql`${rides.driverRating} IS NULL`
            ),
            // User is driver and hasn't rated rider yet
            and(
              eq(rides.driverId, userId),
              sql`${rides.riderRating} IS NULL`
            )
          )
        )
      )
      .orderBy(desc(rides.completedAt));
  }

  async updateUserRating(userId: string): Promise<void> {
    // Calculate new average rating based on all completed rides
    const ridesAsRider = await db
      .select({ rating: rides.riderRating })
      .from(rides)
      .where(
        and(
          eq(rides.riderId, userId),
          eq(rides.status, "completed"),
          sql`${rides.riderRating} IS NOT NULL`
        )
      );

    const ridesAsDriver = await db
      .select({ rating: rides.driverRating })
      .from(rides)
      .where(
        and(
          eq(rides.driverId, userId),
          eq(rides.status, "completed"),
          sql`${rides.driverRating} IS NOT NULL`
        )
      );

    const allRatings = [
      ...ridesAsRider.map(r => r.rating),
      ...ridesAsDriver.map(r => r.rating)
    ].filter(rating => rating !== null);

    if (allRatings.length > 0) {
      const averageRating = allRatings.reduce((sum, rating) => sum + rating, 0) / allRatings.length;
      await db
        .update(users)
        .set({ 
          rating: averageRating.toFixed(2),
          totalRides: allRatings.length,
          updatedAt: new Date()
        })
        .where(eq(users.id, userId));
    }
  }

  // Payment operations
  async confirmCashPayment(rideId: string, confirmerId: string, tipAmount?: number): Promise<Ride> {
    // Get ride and check authorization
    const ride = await this.getRide(rideId);
    if (!ride) {
      throw new Error("Ride not found");
    }
    
    // Only drivers can confirm cash payment received
    if (ride.driverId !== confirmerId) {
      throw new Error("Only the driver can confirm cash payment");
    }
    
    // Ride must be completed to confirm payment
    if (ride.status !== "completed") {
      throw new Error("Ride must be completed before confirming payment");
    }
    
    // Check if payment already confirmed
    if (ride.paymentStatus === "paid_cash") {
      throw new Error("Payment has already been confirmed");
    }

    const updateData: any = {
      paymentStatus: "paid_cash",
      cashReceivedAt: new Date(),
      paidBy: confirmerId,
      updatedAt: new Date()
    };
    
    if (tipAmount !== undefined) {
      updateData.tipAmount = tipAmount.toString();
    }

    const [updatedRide] = await db
      .update(rides)
      .set(updateData)
      .where(eq(rides.id, rideId))
      .returning();
    
    return updatedRide;
  }

  async getRidesAwaitingPayment(userId: string): Promise<any[]> {
    return await db
      .select({
        id: rides.id,
        riderId: rides.riderId,
        driverId: rides.driverId,
        pickupLocation: rides.pickupLocation,
        destinationLocation: rides.destinationLocation,
        pickupInstructions: rides.pickupInstructions,
        status: rides.status,
        paymentMethod: rides.paymentMethod,
        estimatedFare: rides.estimatedFare,
        actualFare: rides.actualFare,
        distance: rides.distance,
        duration: rides.duration,
        tipAmount: rides.tipAmount,
        paymentStatus: rides.paymentStatus,
        stripePaymentIntentId: rides.stripePaymentIntentId,
        refundedAmount: rides.refundedAmount,
        cancellationFee: rides.cancellationFee,
        cancellationReason: rides.cancellationReason,
        driverTraveledDistance: rides.driverTraveledDistance,
        driverTraveledTime: rides.driverTraveledTime,
        routePath: rides.routePath,
        cashReceivedAt: rides.cashReceivedAt,
        paidBy: rides.paidBy,
        riderRating: rides.riderRating,
        driverRating: rides.driverRating,
        riderReview: rides.riderReview,
        driverReview: rides.driverReview,
        scheduledAt: rides.scheduledAt,
        acceptedAt: rides.acceptedAt,
        startedAt: rides.startedAt,
        completedAt: rides.completedAt,
        createdAt: rides.createdAt,
        updatedAt: rides.updatedAt,
        rider: {
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          rating: users.rating,
          profileImageUrl: users.profileImageUrl
        }
      })
      .from(rides)
      .leftJoin(users, eq(rides.riderId, users.id))
      .where(
        and(
          eq(rides.status, "completed"),
          eq(rides.paymentStatus, "pending_payment"),
          eq(rides.driverId, userId)
        )
      )
      .orderBy(desc(rides.completedAt));
  }

  async updateUserStripeInfo(userId: string, stripeCustomerId?: string, stripePaymentMethodId?: string): Promise<User> {
    const updates: any = { updatedAt: new Date() };
    
    if (stripeCustomerId !== undefined) {
      updates.stripeCustomerId = stripeCustomerId;
    }
    if (stripePaymentMethodId !== undefined) {
      updates.stripePaymentMethodId = stripePaymentMethodId;
    }

    const [user] = await db
      .update(users)
      .set(updates)
      .where(eq(users.id, userId))
      .returning();
    
    return user;
  }

  async setRidePaymentAuthorization(rideId: string, paymentIntentId: string): Promise<Ride> {
    const [ride] = await db
      .update(rides)
      .set({
        stripePaymentIntentId: paymentIntentId,
        paymentStatus: "authorized",
        updatedAt: new Date()
      })
      .where(eq(rides.id, rideId))
      .returning();
    
    return ride;
  }

  async captureRidePayment(rideId: string, capturedAmount?: number, tipAmount?: number): Promise<Ride> {
    const updates: any = {
      paymentStatus: "paid_card",
      updatedAt: new Date()
    };
    
    if (capturedAmount !== undefined) {
      updates.actualFare = capturedAmount.toString();
    }
    if (tipAmount !== undefined) {
      updates.tipAmount = tipAmount.toString();
    }

    const [ride] = await db
      .update(rides)
      .set(updates)
      .where(eq(rides.id, rideId))
      .returning();
    
    return ride;
  }

  async cancelRideWithFee(rideId: string, cancellationFee: number, reason: string, traveledDistance?: number, traveledTime?: number): Promise<Ride> {
    const updates: any = {
      status: "cancelled",
      paymentStatus: "cancelled_with_fee",
      cancellationFee: cancellationFee.toString(),
      cancellationReason: reason,
      updatedAt: new Date()
    };
    
    if (traveledDistance !== undefined) {
      updates.driverTraveledDistance = traveledDistance.toString();
    }
    if (traveledTime !== undefined) {
      updates.driverTraveledTime = traveledTime;
    }

    const [ride] = await db
      .update(rides)
      .set(updates)
      .where(eq(rides.id, rideId))
      .returning();
    
    return ride;
  }

  // Virtual card operations
  async deductVirtualCardBalance(userId: string, amount: number): Promise<User> {
    const user = await this.getUser(userId);
    if (!user) {
      throw new Error("User not found");
    }

    const currentBalance = parseFloat(user.virtualCardBalance || "0");
    if (currentBalance < amount) {
      throw new Error("Insufficient virtual card balance");
    }

    const newBalance = (currentBalance - amount).toFixed(2);

    const [updatedUser] = await db
      .update(users)
      .set({
        virtualCardBalance: newBalance,
        updatedAt: new Date()
      })
      .where(eq(users.id, userId))
      .returning();
    
    return updatedUser;
  }

  async addVirtualCardBalance(userId: string, amount: number): Promise<User> {
    const user = await this.getUser(userId);
    if (!user) {
      throw new Error("User not found");
    }

    const currentBalance = parseFloat(user.virtualCardBalance || "0");
    const newBalance = (currentBalance + amount).toFixed(2);

    const [updatedUser] = await db
      .update(users)
      .set({
        virtualCardBalance: newBalance,
        updatedAt: new Date()
      })
      .where(eq(users.id, userId))
      .returning();
    
    return updatedUser;
  }

  async getVirtualCardBalance(userId: string): Promise<number> {
    const user = await this.getUser(userId);
    if (!user) {
      throw new Error("User not found");
    }
    return parseFloat(user.virtualCardBalance || "0");
  }

  // GPS tracking operations
  async addRouteWaypoint(rideId: string, driverId: string, waypoint: {lat: number, lng: number}): Promise<void> {
    // Get current ride
    const ride = await this.getRide(rideId);
    if (!ride) {
      throw new Error("Ride not found");
    }

    // Verify the ride belongs to this driver
    if (ride.driverId !== driverId) {
      throw new Error("Unauthorized to track this ride");
    }

    // Verify ride is in progress
    if (ride.status !== "in_progress") {
      throw new Error("Can only track location during active rides");
    }

    // Validate waypoint with proper finite number check
    if (!Number.isFinite(waypoint.lat) || !Number.isFinite(waypoint.lng) ||
        waypoint.lat < -90 || waypoint.lat > 90 || 
        waypoint.lng < -180 || waypoint.lng > 180) {
      throw new Error("Invalid waypoint coordinates");
    }

    // Get current route path or initialize empty array
    const currentPath = (ride.routePath as Array<{lat: number, lng: number, timestamp: number}>) || [];
    
    // Add new waypoint with timestamp
    const newWaypoint = {
      lat: waypoint.lat,
      lng: waypoint.lng,
      timestamp: Date.now()
    };
    
    currentPath.push(newWaypoint);

    // Limit to last 1000 waypoints to prevent excessive storage (roughly 30 min at 2 sec intervals)
    const limitedPath = currentPath.slice(-1000);

    // Update ride with new route path
    await db
      .update(rides)
      .set({ 
        routePath: limitedPath as any,
        updatedAt: new Date()
      })
      .where(eq(rides.id, rideId));
  }

  calculateActualDistance(routePath: Array<{lat: number, lng: number, timestamp: number}>): number {
    if (!routePath || routePath.length < 2) {
      return 0;
    }

    // Haversine formula to calculate distance between two GPS coordinates
    const haversineDistance = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
      const R = 3959; // Earth's radius in miles
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLng = (lng2 - lng1) * Math.PI / 180;
      const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLng/2) * Math.sin(dLng/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      return R * c;
    };

    // Sum up distances between consecutive waypoints
    let totalDistance = 0;
    for (let i = 1; i < routePath.length; i++) {
      const prev = routePath[i - 1];
      const curr = routePath[i];
      totalDistance += haversineDistance(prev.lat, prev.lng, curr.lat, curr.lng);
    }

    return totalDistance;
  }

  async getRideStats(rideId: string, userId?: string): Promise<{distance: number, duration: number, estimatedFare: number}> {
    const ride = await this.getRide(rideId);
    if (!ride) {
      throw new Error("Ride not found");
    }

    // Verify authorization if userId provided
    if (userId && ride.driverId !== userId && ride.riderId !== userId) {
      throw new Error("Unauthorized to view this ride's stats");
    }

    // Calculate current distance from GPS waypoints
    const routePath = (ride.routePath as Array<{lat: number, lng: number, timestamp: number}>) || [];
    const distance = this.calculateActualDistance(routePath);

    // Calculate current duration in minutes
    let duration = 0;
    if (ride.startedAt) {
      const startTime = new Date(ride.startedAt).getTime();
      const now = Date.now();
      duration = Math.round((now - startTime) / (1000 * 60));
    }

    // Calculate estimated fare based on current distance/time
    const timeRatePerHour = 18;
    const mileRate = 1.50;
    const minimumFare = 5.00;
    const maximumFare = 100.00;
    
    const durationHours = duration / 60;
    const timeCharge = timeRatePerHour * durationHours;
    const distanceCharge = mileRate * distance;
    let estimatedFare = timeCharge + distanceCharge;
    
    // Apply min/max limits
    estimatedFare = Math.max(minimumFare, Math.min(maximumFare, estimatedFare));
    estimatedFare = Math.round(estimatedFare * 100) / 100; // Round to 2 decimals

    return {
      distance,
      duration,
      estimatedFare
    };
  }

  // ============================================================
  // ADMIN DASHBOARD OPERATIONS
  // ============================================================

  async getDashboardStats(): Promise<{
    totalUsers: number;
    totalDrivers: number;
    onlineDrivers: number;
    activeRides: number;
    completedRidesToday: number;
    revenueToday: number;
    revenueThisMonth: number;
    pendingDisputes: number;
    totalOwners: number;
  }> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

    const [userCount] = await db.select({ count: count() }).from(users);
    const [driverCount] = await db.select({ count: count() }).from(users).where(eq(users.isDriver, true));
    const [onlineCount] = await db.select({ count: count() }).from(driverProfiles).where(eq(driverProfiles.isOnline, true));
    const [activeRideCount] = await db.select({ count: count() }).from(rides).where(
      or(eq(rides.status, "pending"), eq(rides.status, "accepted"), eq(rides.status, "driver_arriving"), eq(rides.status, "in_progress"))
    );
    const [completedToday] = await db.select({ count: count() }).from(rides).where(
      and(eq(rides.status, "completed"), gte(rides.completedAt, today))
    );

    const todayRevenue = await db.select({ total: sum(rides.actualFare) }).from(rides).where(
      and(eq(rides.status, "completed"), gte(rides.completedAt, today))
    );
    const monthRevenue = await db.select({ total: sum(rides.actualFare) }).from(rides).where(
      and(eq(rides.status, "completed"), gte(rides.completedAt, monthStart))
    );

    const [pendingDisputeCount] = await db.select({ count: count() }).from(disputes).where(eq(disputes.status, "pending"));
    const [ownerCount] = await db.select({ count: count() }).from(driverOwnership).where(
      or(eq(driverOwnership.status, "ad_hoc"), eq(driverOwnership.status, "lifetime"))
    );

    return {
      totalUsers: userCount.count,
      totalDrivers: driverCount.count,
      onlineDrivers: onlineCount.count,
      activeRides: activeRideCount.count,
      completedRidesToday: completedToday.count,
      revenueToday: parseFloat(todayRevenue[0]?.total || "0"),
      revenueThisMonth: parseFloat(monthRevenue[0]?.total || "0"),
      pendingDisputes: pendingDisputeCount.count,
      totalOwners: ownerCount.count,
    };
  }

  // ============================================================
  // ADMIN USER & DRIVER MANAGEMENT
  // ============================================================

  async getAllUsers(limit = 100, offset = 0): Promise<User[]> {
    return await db.select().from(users).orderBy(desc(users.createdAt)).limit(limit).offset(offset);
  }

  async getAllDrivers(): Promise<(DriverProfile & { user: User; vehicles: Vehicle[] })[]> {
    const results = await db
      .select()
      .from(driverProfiles)
      .innerJoin(users, eq(driverProfiles.userId, users.id))
      .leftJoin(vehicles, eq(vehicles.driverProfileId, driverProfiles.id))
      .orderBy(desc(driverProfiles.createdAt));

    const driversMap = new Map<string, DriverProfile & { user: User; vehicles: Vehicle[] }>();
    for (const result of results) {
      const driverId = result.driver_profiles.id;
      if (!driversMap.has(driverId)) {
        driversMap.set(driverId, {
          ...result.driver_profiles,
          user: result.users,
          vehicles: []
        });
      }
      if (result.vehicles) {
        driversMap.get(driverId)!.vehicles.push(result.vehicles);
      }
    }
    return Array.from(driversMap.values());
  }

  async adminUpdateUser(userId: string, updates: Partial<{ isAdmin: boolean; isSuspended: boolean; isVerified: boolean; isDriver: boolean }>): Promise<User> {
    const [user] = await db.update(users).set({ ...updates, updatedAt: new Date() }).where(eq(users.id, userId)).returning();
    return user;
  }

  async adminUpdateDriverProfile(userId: string, updates: Partial<{ isVerifiedNeighbor: boolean; isSuspended: boolean; approvalStatus: string }>): Promise<DriverProfile> {
    const [profile] = await db.update(driverProfiles).set({ ...updates, updatedAt: new Date() }).where(eq(driverProfiles.userId, userId)).returning();
    return profile;
  }

  async getAllRides(limit = 100, offset = 0): Promise<Ride[]> {
    return await db.select().from(rides).orderBy(desc(rides.createdAt)).limit(limit).offset(offset);
  }

  async getAllDisputes(): Promise<Dispute[]> {
    return await db.select().from(disputes).orderBy(desc(disputes.createdAt));
  }

  async adminResolveDispute(disputeId: string, resolution: string, resolvedBy: string): Promise<Dispute> {
    const [dispute] = await db.update(disputes).set({
      status: "resolved",
      resolution,
      resolvedBy,
      updatedAt: new Date()
    }).where(eq(disputes.id, disputeId)).returning();
    return dispute;
  }

  // ============================================================
  // ADMIN ACTIVITY LOG
  // ============================================================

  async logAdminAction(adminId: string, action: string, targetType?: string, targetId?: string, details?: Record<string, any>): Promise<void> {
    await db.insert(adminActivityLog).values({ adminId, action, targetType, targetId, details });
  }

  async getAdminActivityLog(limit = 50): Promise<AdminActivityLog[]> {
    return await db.select().from(adminActivityLog).orderBy(desc(adminActivityLog.createdAt)).limit(limit);
  }

  // ============================================================
  // DRIVER HOURS TRACKING
  // ============================================================

  async getOrCreateWeeklyHours(driverId: string, weekStart: string): Promise<DriverWeeklyHours> {
    const [existing] = await db.select().from(driverWeeklyHours)
      .where(and(eq(driverWeeklyHours.driverId, driverId), eq(driverWeeklyHours.weekStart, weekStart)));

    if (existing) return existing;

    const [created] = await db.insert(driverWeeklyHours)
      .values({ driverId, weekStart, totalMinutes: 0, rideCount: 0, qualifiesWeek: false })
      .returning();
    return created;
  }

  async addDriverMinutes(driverId: string, minutes: number): Promise<void> {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(now);
    monday.setDate(now.getDate() + mondayOffset);
    const weekStart = monday.toISOString().split('T')[0];

    const weekly = await this.getOrCreateWeeklyHours(driverId, weekStart);

    const newMinutes = (weekly.totalMinutes || 0) + minutes;
    const newRideCount = (weekly.rideCount || 0) + 1;
    const qualifies = newMinutes >= 2400; // 40 hours = 2400 minutes

    await db.update(driverWeeklyHours).set({
      totalMinutes: newMinutes,
      rideCount: newRideCount,
      qualifiesWeek: qualifies
    }).where(eq(driverWeeklyHours.id, weekly.id));
  }

  async getDriverWeeklyHoursHistory(driverId: string, limit = 52): Promise<DriverWeeklyHours[]> {
    return await db.select().from(driverWeeklyHours)
      .where(eq(driverWeeklyHours.driverId, driverId))
      .orderBy(desc(driverWeeklyHours.weekStart))
      .limit(limit);
  }

  // ============================================================
  // OWNERSHIP ENGINE
  // ============================================================

  async getOrCreateOwnership(driverId: string): Promise<DriverOwnership> {
    const [existing] = await db.select().from(driverOwnership)
      .where(eq(driverOwnership.driverId, driverId));

    if (existing) return existing;

    const [created] = await db.insert(driverOwnership)
      .values({ driverId, status: "none", totalQualifyingWeeks: 0, totalLifetimeMinutes: 0 })
      .returning();
    return created;
  }

  async getDriverOwnershipStatus(driverId: string): Promise<DriverOwnership | undefined> {
    const [ownership] = await db.select().from(driverOwnership)
      .where(eq(driverOwnership.driverId, driverId));
    return ownership;
  }

  async getAllOwners(): Promise<(DriverOwnership & { driver: User })[]> {
    const results = await db.select()
      .from(driverOwnership)
      .innerJoin(users, eq(driverOwnership.driverId, users.id))
      .where(or(eq(driverOwnership.status, "ad_hoc"), eq(driverOwnership.status, "lifetime")))
      .orderBy(desc(driverOwnership.adHocQualificationDate));

    return results.map(r => ({ ...r.driver_ownership, driver: r.users }));
  }

  async getAllOwnershipRecords(): Promise<(DriverOwnership & { driver: User })[]> {
    const results = await db.select()
      .from(driverOwnership)
      .innerJoin(users, eq(driverOwnership.driverId, users.id))
      .orderBy(desc(driverOwnership.createdAt));

    return results.map(r => ({ ...r.driver_ownership, driver: r.users }));
  }

  async recalculateOwnership(): Promise<{ qualified: string[]; disqualified: string[]; redistributed: boolean }> {
    const qualified: string[] = [];
    const disqualified: string[] = [];

    const allDriverOwnership = await db.select()
      .from(driverOwnership)
      .innerJoin(users, eq(driverOwnership.driverId, users.id));

    for (const record of allDriverOwnership) {
      const ownership = record.driver_ownership;
      const driver = record.users;
      const driverRating = parseFloat(driver.rating || "5.00");

      // Count qualifying weeks
      const qualifyingWeeks = await db.select({ count: count() })
        .from(driverWeeklyHours)
        .where(and(
          eq(driverWeeklyHours.driverId, ownership.driverId),
          eq(driverWeeklyHours.qualifiesWeek, true)
        ));

      const totalQualWeeks = qualifyingWeeks[0].count;

      // Calculate total lifetime minutes
      const totalMinutesResult = await db.select({ total: sum(driverWeeklyHours.totalMinutes) })
        .from(driverWeeklyHours)
        .where(eq(driverWeeklyHours.driverId, ownership.driverId));

      const totalMinutes = parseInt(totalMinutesResult[0]?.total || "0");

      // Update totals
      await db.update(driverOwnership).set({
        totalQualifyingWeeks: totalQualWeeks,
        totalLifetimeMinutes: totalMinutes,
        updatedAt: new Date()
      }).where(eq(driverOwnership.id, ownership.id));

      // Check ad-hoc qualification: 12 qualifying weeks + 4.85 rating + no adverse record
      if (ownership.status === "none") {
        if (totalQualWeeks >= 12 && driverRating >= 4.85 && !ownership.hasAdverseRecord) {
          await db.update(driverOwnership).set({
            status: "ad_hoc",
            adHocQualificationDate: new Date(),
            ratingAtQualification: driverRating.toFixed(2),
            trackingStartDate: ownership.trackingStartDate || new Date(),
            updatedAt: new Date()
          }).where(eq(driverOwnership.id, ownership.id));
          qualified.push(ownership.driverId);
        }
      }

      // Check if ad-hoc should be disqualified (rating drop or adverse record)
      if (ownership.status === "ad_hoc") {
        if (driverRating < 4.85 || ownership.hasAdverseRecord) {
          await db.update(driverOwnership).set({
            status: "none",
            adHocQualificationDate: null,
            updatedAt: new Date()
          }).where(eq(driverOwnership.id, ownership.id));
          disqualified.push(ownership.driverId);
        }

        // Check lifetime qualification: 5640 total minutes (1880 hours * 3) within tracking window
        const lifetimeHoursNeeded = 1880 * 60 * 3; // 5640 hours in minutes = 338400 minutes
        if (totalMinutes >= lifetimeHoursNeeded && driverRating >= 4.85 && !ownership.hasAdverseRecord) {
          await db.update(driverOwnership).set({
            status: "lifetime",
            lifetimeQualificationDate: new Date(),
            updatedAt: new Date()
          }).where(eq(driverOwnership.id, ownership.id));
        }
      }

      // Lifetime owners with violations: remove from driving but keep shares
      if (ownership.status === "lifetime" && ownership.hasAdverseRecord) {
        if (!ownership.removedFromDriving) {
          await db.update(driverOwnership).set({
            removedFromDriving: true,
            removalReason: "Adverse record detected",
            updatedAt: new Date()
          }).where(eq(driverOwnership.id, ownership.id));
        }
      }
    }

    // Redistribute shares if any changes
    let redistributed = false;
    if (qualified.length > 0 || disqualified.length > 0) {
      await this.redistributeShares();
      redistributed = true;
    }

    return { qualified, disqualified, redistributed };
  }

  async redistributeShares(): Promise<void> {
    const activeOwners = await this.getAllOwners();
    if (activeOwners.length === 0) return;

    const driverPoolPct = 49.0;
    const sharePerOwner = driverPoolPct / activeOwners.length;

    const previousSnapshot: Record<string, number> = {};
    const newSnapshot: Record<string, number> = {};

    // Revoke existing active certificates
    const existingCerts = await db.select().from(shareCertificates).where(eq(shareCertificates.status, "active"));
    for (const cert of existingCerts) {
      previousSnapshot[cert.ownerId] = parseFloat(cert.sharePercentage || "0");
      await db.update(shareCertificates).set({
        status: "revoked",
        revokedAt: new Date(),
        revokeReason: "Share redistribution",
        updatedAt: new Date()
      }).where(eq(shareCertificates.id, cert.id));
    }

    // Issue new certificates
    for (const owner of activeOwners) {
      const certNumber = `PGR-${Date.now()}-${owner.driverId.slice(-6)}`;
      await db.insert(shareCertificates).values({
        ownerId: owner.driverId,
        ownershipId: owner.id,
        certificateNumber: certNumber,
        sharePercentage: sharePerOwner.toFixed(4),
        status: "active",
      });
      newSnapshot[owner.driverId] = sharePerOwner;
    }

    // Log the rebalance
    await db.insert(ownershipRebalanceLog).values({
      eventType: "redistribution",
      previousSnapshot,
      newSnapshot,
      totalActiveOwners: activeOwners.length,
      driverPoolPercentage: driverPoolPct.toFixed(2),
    });
  }

  async getShareCertificates(ownerId?: string): Promise<ShareCertificate[]> {
    if (ownerId) {
      return await db.select().from(shareCertificates)
        .where(and(eq(shareCertificates.ownerId, ownerId), eq(shareCertificates.status, "active")))
        .orderBy(desc(shareCertificates.issuedAt));
    }
    return await db.select().from(shareCertificates)
      .where(eq(shareCertificates.status, "active"))
      .orderBy(desc(shareCertificates.issuedAt));
  }

  async getRebalanceLog(limit = 20): Promise<any[]> {
    return await db.select().from(ownershipRebalanceLog).orderBy(desc(ownershipRebalanceLog.createdAt)).limit(limit);
  }

  // ============================================================
  // PROFIT DECLARATION & DISTRIBUTION
  // ============================================================

  async createProfitDeclaration(data: {
    fiscalYear: number;
    totalRevenue: string;
    totalExpenses: string;
    netProfit: string;
    distributableProfit: string;
    declaredBy: string;
    boardNotes?: string;
  }): Promise<ProfitDeclaration> {
    const [declaration] = await db.insert(profitDeclarations).values({
      ...data,
      status: "draft",
    }).returning();
    return declaration;
  }

  async getProfitDeclarations(): Promise<ProfitDeclaration[]> {
    return await db.select().from(profitDeclarations).orderBy(desc(profitDeclarations.fiscalYear));
  }

  async declareProfitDistribution(declarationId: string): Promise<ProfitDeclaration> {
    const [declaration] = await db.select().from(profitDeclarations).where(eq(profitDeclarations.id, declarationId));
    if (!declaration) throw new Error("Declaration not found");
    if (declaration.status !== "draft") throw new Error("Can only declare draft declarations");

    // Update status to declared
    const [updated] = await db.update(profitDeclarations).set({
      status: "declared",
      declaredAt: new Date(),
      updatedAt: new Date()
    }).where(eq(profitDeclarations.id, declarationId)).returning();

    return updated;
  }

  async distributeProfits(declarationId: string): Promise<ProfitDistribution[]> {
    const [declaration] = await db.select().from(profitDeclarations).where(eq(profitDeclarations.id, declarationId));
    if (!declaration) throw new Error("Declaration not found");
    if (declaration.status !== "declared") throw new Error("Must be declared before distributing");

    const distributableProfit = parseFloat(declaration.distributableProfit || "0");
    const activeOwners = await this.getAllOwners();
    const activeCerts = await this.getShareCertificates();

    const distributions: ProfitDistribution[] = [];

    // Owner (platform) gets 51%
    const platformShare = distributableProfit * 0.51;

    // Driver pool (49%) distributed according to share certificates
    for (const cert of activeCerts) {
      const sharePercent = parseFloat(cert.sharePercentage || "0");
      const amount = (distributableProfit * sharePercent / 100).toFixed(2);

      const owner = activeOwners.find(o => o.driverId === cert.ownerId);

      const [dist] = await db.insert(profitDistributions).values({
        declarationId,
        ownerId: cert.ownerId,
        sharePercentage: cert.sharePercentage,
        ownershipType: owner?.status || "ad_hoc",
        amount,
        status: "pending",
      }).returning();
      distributions.push(dist);
    }

    // Update declaration status
    await db.update(profitDeclarations).set({
      status: "distributed",
      distributedAt: new Date(),
      updatedAt: new Date()
    }).where(eq(profitDeclarations.id, declarationId));

    return distributions;
  }

  async getProfitDistributions(declarationId: string): Promise<ProfitDistribution[]> {
    return await db.select().from(profitDistributions)
      .where(eq(profitDistributions.declarationId, declarationId))
      .orderBy(desc(profitDistributions.amount));
  }

  async getDriverProfitDistributions(driverId: string): Promise<(ProfitDistribution & { declaration: ProfitDeclaration })[]> {
    const results = await db.select()
      .from(profitDistributions)
      .innerJoin(profitDeclarations, eq(profitDistributions.declarationId, profitDeclarations.id))
      .where(eq(profitDistributions.ownerId, driverId))
      .orderBy(desc(profitDeclarations.fiscalYear));

    return results.map(r => ({ ...r.profit_distributions, declaration: r.profit_declarations }));
  }

  // ============================================================
  // FINANCIAL SUMMARY
  // ============================================================

  async getFinancialSummary(year?: number): Promise<{
    totalRevenue: number;
    totalFares: number;
    totalTips: number;
    totalCancellationFees: number;
    rideCount: number;
  }> {
    const yearStart = new Date(year || new Date().getFullYear(), 0, 1);
    const yearEnd = new Date((year || new Date().getFullYear()) + 1, 0, 1);

    const completedRides = await db.select({
      fare: rides.actualFare,
      tip: rides.tipAmount,
      cancelFee: rides.cancellationFee,
    }).from(rides).where(
      and(
        eq(rides.status, "completed"),
        gte(rides.completedAt, yearStart),
        lte(rides.completedAt, yearEnd)
      )
    );

    const cancelledWithFeeRides = await db.select({
      cancelFee: rides.cancellationFee,
    }).from(rides).where(
      and(
        eq(rides.paymentStatus, "cancelled_with_fee"),
        gte(rides.createdAt, yearStart),
        lte(rides.createdAt, yearEnd)
      )
    );

    let totalFares = 0, totalTips = 0, totalCancelFees = 0;
    for (const r of completedRides) {
      totalFares += parseFloat(r.fare || "0");
      totalTips += parseFloat(r.tip || "0");
    }
    for (const r of cancelledWithFeeRides) {
      totalCancelFees += parseFloat(r.cancelFee || "0");
    }

    return {
      totalRevenue: totalFares + totalTips + totalCancelFees,
      totalFares,
      totalTips,
      totalCancellationFees: totalCancelFees,
      rideCount: completedRides.length,
    };
  }
}

export const storage = new DatabaseStorage();
