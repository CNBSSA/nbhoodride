import {
  users,
  driverProfiles,
  vehicles,
  rides,
  disputes,
  emergencyIncidents,
  type User,
  type UpsertUser,
  type DriverProfile,
  type Vehicle,
  type Ride,
  type Dispute,
  type EmergencyIncident,
  type InsertDriverProfile,
  type InsertVehicle,
  type InsertRide,
  type InsertDispute,
  type InsertEmergencyIncident,
} from "@shared/schema";
import { db } from "./db";
import { eq, and, desc, asc, sql, or } from "drizzle-orm";

export interface IStorage {
  // User operations (required for Replit Auth)
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  
  // Driver operations
  createDriverProfile(profile: InsertDriverProfile): Promise<DriverProfile>;
  getDriverProfile(userId: string): Promise<DriverProfile | undefined>;
  updateDriverProfile(userId: string, updates: Partial<InsertDriverProfile>): Promise<DriverProfile>;
  updateDriverLocation(userId: string, location: {lat: number, lng: number}): Promise<void>;
  toggleDriverOnlineStatus(userId: string, isOnline: boolean): Promise<void>;
  getNearbyDrivers(location: {lat: number, lng: number}, radiusKm: number): Promise<(DriverProfile & {user: User, vehicles: Vehicle[]})[]>;
  
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
  
  // Rating operations
  updateRideRating(rideId: string, raterId: string, rating: number, review?: string): Promise<void>;
  
  // Dispute operations
  createDispute(dispute: InsertDispute): Promise<Dispute>;
  getDisputesByRide(rideId: string): Promise<Dispute[]>;
  updateDispute(disputeId: string, updates: Partial<InsertDispute>): Promise<Dispute>;
  
  // Emergency operations
  createEmergencyIncident(incident: InsertEmergencyIncident): Promise<EmergencyIncident>;
  getActiveEmergencyIncidents(): Promise<EmergencyIncident[]>;
  updateEmergencyIncident(incidentId: string, updates: Partial<InsertEmergencyIncident>): Promise<EmergencyIncident>;
  
  // Earnings operations
  getDriverEarnings(driverId: string, period: 'today' | 'week' | 'month'): Promise<{fare: number, tips: number, total: number, rideCount: number}>;
  getDriverRides(driverId: string, period: 'today' | 'week' | 'month'): Promise<Ride[]>;
  
  // Driver ride management operations
  getPendingRidesForDriver(driverId: string): Promise<Ride[]>;
  acceptRide(rideId: string, driverId: string): Promise<Ride>;
  declineRide(rideId: string, driverId: string): Promise<void>;
  startRide(rideId: string, driverId: string): Promise<Ride>;
  completeRide(rideId: string, driverId: string, actualFare?: number): Promise<Ride>;
  getActiveRidesForDriver(driverId: string): Promise<Ride[]>;
}

export class DatabaseStorage implements IStorage {
  // User operations
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...userData,
          updatedAt: new Date(),
        },
      })
      .returning();
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
    // For now, return all online drivers - in production, implement proper geospatial query
    const results = await db
      .select()
      .from(driverProfiles)
      .innerJoin(users, eq(driverProfiles.userId, users.id))
      .leftJoin(vehicles, eq(vehicles.driverProfileId, driverProfiles.id))
      .where(eq(driverProfiles.isOnline, true));

    // Group vehicles by driver
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

    return Array.from(driversMap.values());
  }

  // Vehicle operations
  async createVehicle(vehicle: InsertVehicle): Promise<Vehicle> {
    const [newVehicle] = await db
      .insert(vehicles)
      .values(vehicle)
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
      .values(ride)
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
      .set({ ...updates, updatedAt: new Date() })
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
  async getPendingRidesForDriver(driverId: string): Promise<Ride[]> {
    return await db
      .select({
        id: rides.id,
        riderId: rides.riderId,
        driverId: rides.driverId,
        pickupLocation: rides.pickupLocation,
        destinationLocation: rides.destinationLocation,
        pickupInstructions: rides.pickupInstructions,
        status: rides.status,
        estimatedFare: rides.estimatedFare,
        actualFare: rides.actualFare,
        distance: rides.distance,
        duration: rides.duration,
        tipAmount: rides.tipAmount,
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
        // Include rider details
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

    const updateData: any = { 
      status: "completed",
      completedAt: new Date(),
      updatedAt: new Date()
    };
    
    if (actualFare !== undefined) {
      updateData.actualFare = actualFare.toString();
    }

    // Update ride status to completed
    const [updatedRide] = await db
      .update(rides)
      .set(updateData)
      .where(eq(rides.id, rideId))
      .returning();
    
    return updatedRide;
  }

  async getActiveRidesForDriver(driverId: string): Promise<Ride[]> {
    return await db
      .select({
        id: rides.id,
        riderId: rides.riderId,
        driverId: rides.driverId,
        pickupLocation: rides.pickupLocation,
        destinationLocation: rides.destinationLocation,
        pickupInstructions: rides.pickupInstructions,
        status: rides.status,
        estimatedFare: rides.estimatedFare,
        actualFare: rides.actualFare,
        distance: rides.distance,
        duration: rides.duration,
        tipAmount: rides.tipAmount,
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
        // Include rider details
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
}

export const storage = new DatabaseStorage();
