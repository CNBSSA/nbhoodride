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
        photos: updates.photos || []
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
}

export const storage = new DatabaseStorage();
