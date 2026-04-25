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
  conversations,
  chatMessages,
  eventTracking,
  aiFeedback,
  platformInsights,
  faqEntries,
  demandHeatmap,
  driverScorecard,
  safetyAlerts,
  payoutRequests,
  pushSubscriptions,
  rideGroups,
  walletTransactions,
  type PayoutRequest,
  type InsertPayoutRequest,
  type PushSubscription,
  type RideGroup,
  type InsertRideGroup,
  type WalletTransaction,
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
  type Conversation,
  type ChatMessage,
  type EventTracking,
  type AiFeedback,
  type PlatformInsight,
  type FaqEntry,
  type DemandHeatmapEntry,
  type DriverScorecardEntry,
  type SafetyAlert,
  type InsertDriverProfile,
  type InsertVehicle,
  type InsertRide,
  type InsertDispute,
  type InsertEmergencyIncident,
  driverRateCards,
  type DriverRateCard,
} from "@shared/schema";
import { db } from "./db";
import { eq, and, desc, asc, sql, or, isNull, isNotNull, gt, like, inArray, count, sum, gte, lte } from "drizzle-orm";
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
  const straightLineMiles = haversineDistance(pickup.lat, pickup.lng, dest.lat, dest.lng);
  const roadMiles = straightLineMiles * 1.3;
  const avgSpeedMph = 25;
  return Math.max(5, (roadMiles / avgSpeedMph) * 60);
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
  
  deleteUser(userId: string): Promise<void>;
  deleteDriverProfile(userId: string): Promise<void>;
  
  // Driver operations
  createDriverProfile(profile: InsertDriverProfile): Promise<DriverProfile>;
  getDriverProfile(userId: string): Promise<DriverProfile | undefined>;
  updateDriverProfile(userId: string, updates: Partial<InsertDriverProfile>): Promise<DriverProfile>;
  updateDriverLocation(userId: string, location: {lat: number, lng: number}): Promise<void>;
  toggleDriverOnlineStatus(userId: string, isOnline: boolean): Promise<void>;
  getNearbyDrivers(location: {lat: number, lng: number}, radiusMiles: number): Promise<(DriverProfile & {user: User, vehicles: Vehicle[]})[]>;
  searchDriversByPhone(phone: string): Promise<(DriverProfile & {user: User, vehicles: Vehicle[]})[]>;
  
  getAllDriverProfiles(): Promise<DriverProfile[]>;
  getAllCompletedRides(): Promise<Ride[]>;
  
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
  deductVirtualCardBalance(userId: string, amount: number, reason?: string, rideId?: string, performedBy?: string): Promise<User>;
  addVirtualCardBalance(userId: string, amount: number, reason?: string, rideId?: string, performedBy?: string): Promise<User>;
  getVirtualCardBalance(userId: string): Promise<number>;
  consumePromoRide(userId: string, discountAmount: number, rideId: string): Promise<void>;
  logWalletTransaction(data: { userId: string; amount: number; balanceAfter: number; reason: string; rideId?: string; disputeId?: string; performedBy?: string }): Promise<WalletTransaction>;
  getWalletTransactions(userId: string, limit?: number): Promise<WalletTransaction[]>;
  
  // Push subscription operations
  savePushSubscription(userId: string, sub: { endpoint: string; p256dh: string; auth: string }): Promise<PushSubscription>;
  getPushSubscriptionsByUser(userId: string): Promise<PushSubscription[]>;
  deletePushSubscription(endpoint: string): Promise<void>;

  // Payout request operations
  createPayoutRequest(request: InsertPayoutRequest): Promise<PayoutRequest>;
  getDriverPayoutRequests(driverId: string): Promise<PayoutRequest[]>;
  getAllPayoutRequests(): Promise<(PayoutRequest & { driverName: string; driverEmail: string })[]>;
  updatePayoutRequest(id: string, updates: { status: string; adminNote?: string; processedBy?: string }): Promise<PayoutRequest>;

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
  
  // Scheduled ride operations
  getOpenScheduledRides(driverCounties?: string[]): Promise<any[]>;
  updateRideCounty(rideId: string, county: string): Promise<void>;
  getScheduledRidesWithDriver(userId: string): Promise<any[]>;
  claimScheduledRide(rideId: string, driverId: string): Promise<Ride>;
  getDriverUpcomingRides(driverId: string): Promise<any[]>;

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

  // Rate card operations
  getDriverRateCard(driverId: string): Promise<DriverRateCard | undefined>;
  upsertDriverRateCard(driverId: string, data: Partial<DriverRateCard>): Promise<DriverRateCard>;

  // AI Chat operations
  getConversationsByUser(userId: string): Promise<Conversation[]>;
  getConversation(id: string, userId?: string): Promise<Conversation | undefined>;
  createConversation(userId: string, title: string): Promise<Conversation>;
  deleteConversation(id: string, userId: string): Promise<void>;
  getChatMessages(conversationId: string): Promise<ChatMessage[]>;
  createChatMessage(conversationId: string, role: string, content: string): Promise<ChatMessage>;

  // Analytics & Self-Learning operations
  trackEvent(data: { userId?: string; eventType: string; eventCategory: string; eventData?: Record<string, any>; sessionId?: string }): Promise<EventTracking>;
  getEventsByType(eventType: string, limit?: number): Promise<EventTracking[]>;
  getEventStats(startDate: Date, endDate: Date): Promise<{ eventType: string; count: number }[]>;
  submitAiFeedback(data: { messageId: string; conversationId: string; userId: string; rating: string; reason?: string }): Promise<AiFeedback>;
  getAiFeedbackStats(): Promise<{ positive: number; negative: number; total: number }>;
  createPlatformInsight(data: { insightType: string; category: string; title: string; description?: string; data?: Record<string, any>; severity?: string; isActionable?: boolean }): Promise<PlatformInsight>;
  getPlatformInsights(limit?: number): Promise<PlatformInsight[]>;
  getUnreadInsights(): Promise<PlatformInsight[]>;
  markInsightRead(id: string): Promise<void>;
  createFaqEntry(data: { question: string; answer: string; category: string }): Promise<FaqEntry>;
  getFaqEntries(publishedOnly?: boolean): Promise<FaqEntry[]>;
  updateFaqEntry(id: string, updates: Partial<{ question: string; answer: string; category: string; isPublished: boolean }>): Promise<FaqEntry>;
  upsertDemandHeatmap(data: { gridLat: string; gridLng: string; hourOfDay: number; dayOfWeek: number; rideCount: number; avgFare?: string; avgWaitTime?: number }): Promise<DemandHeatmapEntry>;
  getDemandHeatmap(hourOfDay?: number, dayOfWeek?: number): Promise<DemandHeatmapEntry[]>;
  upsertDriverScorecard(driverId: string): Promise<DriverScorecardEntry>;
  getDriverScorecard(driverId: string): Promise<DriverScorecardEntry | undefined>;
  getAllDriverScorecards(): Promise<DriverScorecardEntry[]>;
  createSafetyAlert(data: { alertType: string; severity: string; targetUserId?: string; title: string; description?: string; data?: Record<string, any> }): Promise<SafetyAlert>;
  getActiveSafetyAlerts(): Promise<SafetyAlert[]>;
  resolveSafetyAlert(id: string, resolvedBy: string): Promise<SafetyAlert>;
  getConversionMetrics(startDate: Date, endDate: Date): Promise<{ searches: number; bookings: number; completions: number; conversionRate: number }>;
  getDriverOptimalHours(driverId: string): Promise<{ hour: number; dayOfWeek: number; avgRides: number; avgEarnings: number }[]>;
  // Driver hour tracking for ownership qualification
  getOrCreateWeeklyHours(driverId: string, weekStart: string): Promise<DriverWeeklyHours>;
  addDriverMinutes(driverId: string, minutes: number): Promise<void>;
  // Ride groups (Mode 3: multi-stop, Mode 4: shared schedule)
  createRideGroup(data: InsertRideGroup): Promise<RideGroup>;
  getRideGroupByCode(code: string): Promise<RideGroup | undefined>;
  getRideGroupById(id: string): Promise<RideGroup | undefined>;
  updateRideGroup(id: string, updates: Partial<RideGroup>): Promise<RideGroup>;
  getRidesInGroup(groupId: string): Promise<Ride[]>;
  applyGroupDiscount(groupId: string, discountPct: number): Promise<void>;
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

  async getNearbyDrivers(location: {lat: number, lng: number}, radiusMiles: number): Promise<(DriverProfile & {user: User, vehicles: Vehicle[]})[]> {
    // Fetch all active drivers (not suspended) — show pending/approved drivers during early launch
    // Admins can suspend bad actors; the approval gate is secondary during onboarding
    const results = await db
      .select()
      .from(driverProfiles)
      .innerJoin(users, eq(driverProfiles.userId, users.id))
      .leftJoin(vehicles, eq(vehicles.driverProfileId, driverProfiles.id))
      .where(
        and(
          eq(driverProfiles.isSuspended, false),
          eq(users.isSuspended, false)
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

    // Assign a default PG County location for drivers who haven't set one yet
    const PG_COUNTY_CENTER = { lat: 38.9073, lng: -76.7781 };
    const driversWithLocation = allDrivers.map(driver => {
      const loc = driver.currentLocation as { lat: number; lng: number } | null;
      if (!loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) {
        return { ...driver, currentLocation: PG_COUNTY_CENTER };
      }
      return driver;
    });

    // Prefer drivers within radius; fall back to all approved drivers if none are nearby
    const nearby = driversWithLocation.filter(driver => {
      const loc = driver.currentLocation as { lat: number; lng: number };
      const distance = haversineDistance(location.lat, location.lng, loc.lat, loc.lng);
      return distance <= radiusMiles;
    });

    const pool = nearby.length > 0 ? nearby : driversWithLocation;

    // Online drivers first, then offline
    pool.sort((a, b) => (b.isOnline ? 1 : 0) - (a.isOnline ? 1 : 0));

    return filterAvailableDrivers(pool, (d) => d.userId);
  }

  async getAllDriverProfiles(): Promise<DriverProfile[]> {
    return db.select().from(driverProfiles);
  }

  async getAllCompletedRides(): Promise<Ride[]> {
    return db.select().from(rides).where(eq(rides.status, "completed")).orderBy(desc(rides.completedAt));
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

  async getScheduledRidesWithDriver(userId: string): Promise<any[]> {
    const driverAlias = alias(users, 'driver_user');
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
        scheduledAt: rides.scheduledAt,
        createdAt: rides.createdAt,
        driver: {
          id: driverAlias.id,
          firstName: driverAlias.firstName,
          lastName: driverAlias.lastName,
          rating: driverAlias.rating,
          profileImageUrl: driverAlias.profileImageUrl,
        }
      })
      .from(rides)
      .leftJoin(driverAlias, eq(rides.driverId, driverAlias.id))
      .where(
        and(
          eq(rides.riderId, userId),
          isNotNull(rides.scheduledAt),
          gt(rides.scheduledAt, sql`now()`),
          sql`${rides.status} IN ('pending', 'accepted')`
        )
      )
      .orderBy(asc(rides.scheduledAt));
  }

  async getOpenScheduledRides(driverCounties?: string[]): Promise<any[]> {
    const riderAlias = alias(users, 'rider_user');
    const baseWhere = and(
      eq(rides.status, "pending"),
      isNotNull(rides.scheduledAt),
      gt(rides.scheduledAt, sql`now()`),
      sql`${rides.driverId} IS NULL`
    );

    // If driver has specific county preferences, filter to rides in those counties.
    // Rides without a recorded county are shown to everyone (county detection may have failed).
    const countyWhere = driverCounties && driverCounties.length > 0
      ? and(baseWhere, or(
          isNull(rides.pickupCounty),
          inArray(rides.pickupCounty, driverCounties)
        ))
      : baseWhere;

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
        scheduledAt: rides.scheduledAt,
        pickupCounty: rides.pickupCounty,
        createdAt: rides.createdAt,
        rider: {
          id: riderAlias.id,
          firstName: riderAlias.firstName,
          lastName: riderAlias.lastName,
          rating: riderAlias.rating,
        }
      })
      .from(rides)
      .leftJoin(riderAlias, eq(rides.riderId, riderAlias.id))
      .where(countyWhere)
      .orderBy(asc(rides.scheduledAt));
  }

  async updateRideCounty(rideId: string, county: string): Promise<void> {
    await db
      .update(rides)
      .set({ pickupCounty: county, updatedAt: new Date() })
      .where(eq(rides.id, rideId));
  }

  async claimScheduledRide(rideId: string, driverId: string): Promise<Ride> {
    const ride = await this.getRide(rideId);
    if (!ride) throw new Error("Ride not found");
    if (ride.driverId) throw new Error("This ride has already been claimed by another driver");
    if (!ride.scheduledAt) throw new Error("This is not a scheduled ride");
    if (new Date(ride.scheduledAt) <= new Date()) throw new Error("This scheduled ride has already passed");

    const [updated] = await db
      .update(rides)
      .set({ driverId, updatedAt: new Date() })
      .where(
        and(
          eq(rides.id, rideId),
          sql`${rides.driverId} IS NULL`
        )
      )
      .returning();

    if (!updated) throw new Error("Ride was just claimed by another driver");
    return updated;
  }

  async getDriverUpcomingRides(driverId: string): Promise<any[]> {
    const riderAlias = alias(users, 'rider_user');
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
        scheduledAt: rides.scheduledAt,
        createdAt: rides.createdAt,
        rider: {
          id: riderAlias.id,
          firstName: riderAlias.firstName,
          lastName: riderAlias.lastName,
          rating: riderAlias.rating,
          profileImageUrl: riderAlias.profileImageUrl,
        }
      })
      .from(rides)
      .leftJoin(riderAlias, eq(rides.riderId, riderAlias.id))
      .where(
        and(
          eq(rides.driverId, driverId),
          isNotNull(rides.scheduledAt),
          gt(rides.scheduledAt, sql`now()`),
          sql`${rides.status} IN ('pending', 'accepted')`
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

  // Push subscription operations
  async savePushSubscription(userId: string, sub: { endpoint: string; p256dh: string; auth: string }): Promise<PushSubscription> {
    const [record] = await db
      .insert(pushSubscriptions)
      .values({ userId, endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth })
      .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { userId, p256dh: sub.p256dh, auth: sub.auth } })
      .returning();
    return record;
  }

  async getPushSubscriptionsByUser(userId: string): Promise<PushSubscription[]> {
    return await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
  }

  async deletePushSubscription(endpoint: string): Promise<void> {
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
  }

  // Payout request operations
  async createPayoutRequest(request: InsertPayoutRequest): Promise<PayoutRequest> {
    const [record] = await db.insert(payoutRequests).values(request).returning();
    return record;
  }

  async getDriverPayoutRequests(driverId: string): Promise<PayoutRequest[]> {
    return await db
      .select()
      .from(payoutRequests)
      .where(eq(payoutRequests.driverId, driverId))
      .orderBy(desc(payoutRequests.createdAt));
  }

  async getAllPayoutRequests(): Promise<(PayoutRequest & { driverName: string; driverEmail: string })[]> {
    const rows = await db
      .select({
        payout: payoutRequests,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
      })
      .from(payoutRequests)
      .leftJoin(users, eq(payoutRequests.driverId, users.id))
      .orderBy(desc(payoutRequests.createdAt));

    return rows.map((r) => ({
      ...r.payout,
      driverName: `${r.firstName || ''} ${r.lastName || ''}`.trim(),
      driverEmail: r.email || '',
    }));
  }

  async updatePayoutRequest(
    id: string,
    updates: { status: string; adminNote?: string; processedBy?: string }
  ): Promise<PayoutRequest> {
    const [record] = await db
      .update(payoutRequests)
      .set({
        status: updates.status,
        ...(updates.adminNote !== undefined && { adminNote: updates.adminNote }),
        ...(updates.processedBy && { processedBy: updates.processedBy, processedAt: new Date() }),
        updatedAt: new Date(),
      })
      .where(eq(payoutRequests.id, id))
      .returning();
    return record;
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

    const result = await db
      .update(rides)
      .set({ 
        status: "accepted",
        acceptedAt: new Date(),
        updatedAt: new Date()
      })
      .where(and(eq(rides.id, rideId), eq(rides.status, "pending")))
      .returning();
    
    if (result.length === 0) {
      throw new Error("Ride is no longer available");
    }
    
    return result[0];
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
      
      if (actualFare === undefined) {
        const rateCard = ride.driverId ? await this.getDriverRateCard(ride.driverId) : undefined;
        const rates = this.getRates(rateCard);

        const baseFare = rates.baseFare;
        const timeCharge = rates.perMinuteRate * durationMinutes;
        const distanceCharge = rates.perMileRate * actualDistance;
        let fareAmount = baseFare + timeCharge + distanceCharge + rates.surgeAdjustment;
        fareAmount = Math.max(rates.minimumFare, Math.min(100, fareAmount));
        calculatedFare = Math.round(fareAmount * 100) / 100;
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
  async deductVirtualCardBalance(userId: string, amount: number, reason = "ride_charge", rideId?: string, performedBy?: string): Promise<User> {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("Amount must be a positive number");
    }

    const [updatedUser] = await db
      .update(users)
      .set({
        virtualCardBalance: sql`(CAST(COALESCE(${users.virtualCardBalance}, '0') AS DECIMAL(10,2)) - ${amount})`,
        updatedAt: new Date()
      })
      .where(
        and(
          eq(users.id, userId),
          sql`CAST(COALESCE(${users.virtualCardBalance}, '0') AS DECIMAL(10,2)) >= ${amount}`
        )
      )
      .returning();

    if (!updatedUser) {
      const user = await this.getUser(userId);
      if (!user) throw new Error("User not found");
      throw new Error("Insufficient virtual card balance");
    }

    // Log immutable ledger entry
    await this.logWalletTransaction({
      userId,
      amount: -amount,
      balanceAfter: parseFloat(updatedUser.virtualCardBalance || "0"),
      reason,
      rideId,
      performedBy,
    });

    return updatedUser;
  }

  async addVirtualCardBalance(userId: string, amount: number, reason = "topup", rideId?: string, performedBy?: string): Promise<User> {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("Amount must be a positive number");
    }

    const [updatedUser] = await db
      .update(users)
      .set({
        virtualCardBalance: sql`(CAST(COALESCE(${users.virtualCardBalance}, '0') AS DECIMAL(10,2)) + ${amount})`,
        updatedAt: new Date()
      })
      .where(eq(users.id, userId))
      .returning();

    if (!updatedUser) {
      throw new Error("User not found");
    }

    // Log immutable ledger entry
    await this.logWalletTransaction({
      userId,
      amount,
      balanceAfter: parseFloat(updatedUser.virtualCardBalance || "0"),
      reason,
      rideId,
      performedBy,
    });

    return updatedUser;
  }

  async getVirtualCardBalance(userId: string): Promise<number> {
    const user = await this.getUser(userId);
    if (!user) {
      throw new Error("User not found");
    }
    return parseFloat(user.virtualCardBalance || "0");
  }

  async logWalletTransaction(data: { userId: string; amount: number; balanceAfter: number; reason: string; rideId?: string; disputeId?: string; performedBy?: string }): Promise<WalletTransaction> {
    const [entry] = await db
      .insert(walletTransactions)
      .values({
        userId: data.userId,
        amount: data.amount.toFixed(2),
        balanceAfter: data.balanceAfter.toFixed(2),
        reason: data.reason,
        rideId: data.rideId ?? null,
        disputeId: data.disputeId ?? null,
        performedBy: data.performedBy ?? null,
      })
      .returning();
    return entry;
  }

  async getWalletTransactions(userId: string, limit = 50): Promise<WalletTransaction[]> {
    return db
      .select()
      .from(walletTransactions)
      .where(eq(walletTransactions.userId, userId))
      .orderBy(desc(walletTransactions.createdAt))
      .limit(limit);
  }

  async consumePromoRide(userId: string, discountAmount: number, rideId: string): Promise<void> {
    // Decrement promoRidesRemaining by 1 (floor at 0) and record discount on the ride
    await db.update(users)
      .set({
        promoRidesRemaining: sql`GREATEST(0, COALESCE(${users.promoRidesRemaining}, 0) - 1)`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));

    // Record the promo discount on the ride
    await db.update(rides)
      .set({ promoDiscountApplied: discountAmount.toString(), updatedAt: new Date() })
      .where(eq(rides.id, rideId));
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

    const GPS_NOISE_THRESHOLD_MILES = 0.005;
    const MAX_SPEED_MPH = 90;

    let totalDistance = 0;
    for (let i = 1; i < routePath.length; i++) {
      const prev = routePath[i - 1];
      const curr = routePath[i];

      if (!Number.isFinite(curr.lat) || !Number.isFinite(curr.lng) ||
          !Number.isFinite(prev.lat) || !Number.isFinite(prev.lng)) {
        continue;
      }

      const segmentDistance = haversineDistance(prev.lat, prev.lng, curr.lat, curr.lng);

      if (segmentDistance < GPS_NOISE_THRESHOLD_MILES) {
        continue;
      }

      if (prev.timestamp && curr.timestamp) {
        const timeDiffHours = (curr.timestamp - prev.timestamp) / (1000 * 3600);
        if (timeDiffHours > 0) {
          const speed = segmentDistance / timeDiffHours;
          if (speed > MAX_SPEED_MPH) {
            continue;
          }
        }
      }

      totalDistance += segmentDistance;
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

    // Get driver rate card for fare calculation
    const rateCard = ride.driverId ? await this.getDriverRateCard(ride.driverId) : undefined;
    const rates = this.getRates(rateCard);

    const baseFare = rates.baseFare;
    const timeCharge = rates.perMinuteRate * duration;
    const distanceCharge = rates.perMileRate * distance;
    let estimatedFare = baseFare + timeCharge + distanceCharge + rates.surgeAdjustment;

    estimatedFare = Math.max(rates.minimumFare, Math.min(100, estimatedFare));
    estimatedFare = Math.round(estimatedFare * 100) / 100;

    return {
      distance,
      duration,
      estimatedFare
    };
  }

  private getRates(rateCard?: DriverRateCard) {
    const SUGGESTED = { minimumFare: 7.65, baseFare: 4.00, perMinuteRate: 0.29, perMileRate: 0.90, surgeAdjustment: 0 };
    if (!rateCard || rateCard.useSuggested) return SUGGESTED;
    return {
      minimumFare: parseFloat(rateCard.minimumFare || "7.65"),
      baseFare: parseFloat(rateCard.baseFare || "4.00"),
      perMinuteRate: parseFloat(rateCard.perMinuteRate || "0.2900"),
      perMileRate: parseFloat(rateCard.perMileRate || "0.9000"),
      surgeAdjustment: parseFloat(rateCard.surgeAdjustment || "0.00"),
    };
  }

  // Rate card operations
  async getDriverRateCard(driverId: string): Promise<DriverRateCard | undefined> {
    const [card] = await db.select().from(driverRateCards).where(eq(driverRateCards.driverId, driverId));
    return card;
  }

  async upsertDriverRateCard(driverId: string, data: Partial<DriverRateCard>): Promise<DriverRateCard> {
    const existing = await this.getDriverRateCard(driverId);
    if (existing) {
      const [updated] = await db.update(driverRateCards)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(driverRateCards.driverId, driverId))
        .returning();
      return updated;
    }
    const [created] = await db.insert(driverRateCards)
      .values({ driverId, ...data })
      .returning();
    return created;
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

  async adminUpdateUser(userId: string, updates: Partial<{ isAdmin: boolean; isSuperAdmin: boolean; isApproved: boolean; approvedBy: string; isSuspended: boolean; isVerified: boolean; isDriver: boolean }>): Promise<User> {
    const [user] = await db.update(users).set({ ...updates, updatedAt: new Date() }).where(eq(users.id, userId)).returning();
    return user;
  }

  async deleteUser(userId: string): Promise<void> {
    await db.delete(safetyAlerts).where(eq(safetyAlerts.targetUserId, userId));
    await db.delete(driverScorecard).where(eq(driverScorecard.driverId, userId));
    await db.delete(eventTracking).where(eq(eventTracking.userId, userId));
    await db.delete(ownershipRebalanceLog).where(or(eq(ownershipRebalanceLog.triggeredBy, userId), eq(ownershipRebalanceLog.affectedDriverId, userId)));

    const userDeclarations = await db.select({ id: profitDeclarations.id }).from(profitDeclarations).where(eq(profitDeclarations.declaredBy, userId));
    const declIds = userDeclarations.map(d => d.id);
    if (declIds.length > 0) {
      await db.delete(profitDistributions).where(inArray(profitDistributions.declarationId, declIds));
      await db.delete(profitDeclarations).where(inArray(profitDeclarations.id, declIds));
    }
    await db.delete(profitDistributions).where(eq(profitDistributions.ownerId, userId));
    await db.delete(adminActivityLog).where(eq(adminActivityLog.adminId, userId));
    await db.delete(driverWeeklyHours).where(eq(driverWeeklyHours.driverId, userId));
    await db.delete(driverRateCards).where(eq(driverRateCards.driverId, userId));

    await db.delete(shareCertificates).where(or(eq(shareCertificates.ownerId, userId), eq(shareCertificates.transferredTo, userId)));
    await db.delete(driverOwnership).where(eq(driverOwnership.driverId, userId));

    await db.delete(aiFeedback).where(eq(aiFeedback.userId, userId));
    await db.delete(conversations).where(eq(conversations.userId, userId));
    await db.delete(emergencyIncidents).where(eq(emergencyIncidents.userId, userId));

    await db.update(disputes).set({ resolvedBy: null }).where(eq(disputes.resolvedBy, userId));

    const userRides = await db.select({ id: rides.id }).from(rides).where(or(eq(rides.riderId, userId), eq(rides.driverId, userId)));
    const rideIds = userRides.map(r => r.id);
    if (rideIds.length > 0) {
      await db.delete(disputes).where(inArray(disputes.rideId, rideIds));
      await db.delete(rides).where(inArray(rides.id, rideIds));
    }

    const driverProfile = await this.getDriverProfile(userId);
    if (driverProfile) {
      await db.delete(vehicles).where(eq(vehicles.driverProfileId, driverProfile.id));
      await db.delete(driverProfiles).where(eq(driverProfiles.userId, userId));
    }
    await db.delete(users).where(eq(users.id, userId));
  }

  async deleteDriverProfile(userId: string): Promise<void> {
    await db.transaction(async (tx) => {
      const [driverProfile] = await tx.select().from(driverProfiles).where(eq(driverProfiles.userId, userId));
      if (driverProfile) {
        await tx.delete(vehicles).where(eq(vehicles.driverProfileId, driverProfile.id));
        await tx.delete(driverRateCards).where(eq(driverRateCards.driverId, userId));
        await tx.delete(driverScorecard).where(eq(driverScorecard.driverId, userId));
        await tx.delete(driverWeeklyHours).where(eq(driverWeeklyHours.driverId, userId));
        await tx.delete(driverOwnership).where(eq(driverOwnership.driverId, userId));
        await tx.delete(shareCertificates).where(eq(shareCertificates.ownerId, userId));
        await tx.delete(driverProfiles).where(eq(driverProfiles.userId, userId));
      }
      await tx.update(users).set({ isDriver: false, updatedAt: new Date() }).where(eq(users.id, userId));
    });
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

  async adminResolveDispute(disputeId: string, resolution: string, resolvedBy: string, refundAmount?: number): Promise<Dispute> {
    const [dispute] = await db.update(disputes).set({
      status: "resolved",
      resolution,
      resolvedBy,
      updatedAt: new Date()
    }).where(eq(disputes.id, disputeId)).returning();

    // Apply refund to the rider's virtual card if requested
    if (refundAmount && refundAmount > 0 && dispute?.rideId) {
      const [ride] = await db.select().from(rides).where(eq(rides.id, dispute.rideId));
      if (ride?.riderId) {
        await this.addVirtualCardBalance(ride.riderId, refundAmount, "dispute_refund", dispute.rideId, resolvedBy);
        // Mark refunded amount on the ride
        await db.update(rides)
          .set({ refundedAmount: refundAmount.toFixed(2), updatedAt: new Date() })
          .where(eq(rides.id, dispute.rideId));
      }
    }

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

  // AI Chat operations
  async getConversationsByUser(userId: string): Promise<Conversation[]> {
    return db.select().from(conversations).where(eq(conversations.userId, userId)).orderBy(desc(conversations.createdAt));
  }

  async getConversation(id: string, userId?: string): Promise<Conversation | undefined> {
    const conditions = [eq(conversations.id, id)];
    if (userId) conditions.push(eq(conversations.userId, userId));
    const [conversation] = await db.select().from(conversations).where(and(...conditions));
    return conversation;
  }

  async createConversation(userId: string, title: string): Promise<Conversation> {
    const [conversation] = await db.insert(conversations).values({ userId, title }).returning();
    return conversation;
  }

  async deleteConversation(id: string, userId: string): Promise<void> {
    const [convo] = await db.select().from(conversations).where(and(eq(conversations.id, id), eq(conversations.userId, userId)));
    if (!convo) return;
    await db.delete(chatMessages).where(eq(chatMessages.conversationId, id));
    await db.delete(conversations).where(eq(conversations.id, id));
  }

  async getChatMessages(conversationId: string): Promise<ChatMessage[]> {
    return db.select().from(chatMessages).where(eq(chatMessages.conversationId, conversationId)).orderBy(asc(chatMessages.createdAt));
  }

  async createChatMessage(conversationId: string, role: string, content: string): Promise<ChatMessage> {
    const [message] = await db.insert(chatMessages).values({ conversationId, role, content }).returning();
    return message;
  }

  // ============================================================
  // ANALYTICS & SELF-LEARNING
  // ============================================================

  async trackEvent(data: { userId?: string; eventType: string; eventCategory: string; eventData?: Record<string, any>; sessionId?: string }): Promise<EventTracking> {
    const [event] = await db.insert(eventTracking).values(data).returning();
    return event;
  }

  async getEventsByType(eventType: string, limit = 100): Promise<EventTracking[]> {
    return db.select().from(eventTracking).where(eq(eventTracking.eventType, eventType)).orderBy(desc(eventTracking.createdAt)).limit(limit);
  }

  async getEventStats(startDate: Date, endDate: Date): Promise<{ eventType: string; count: number }[]> {
    const results = await db.select({
      eventType: eventTracking.eventType,
      count: count(),
    }).from(eventTracking).where(
      and(gte(eventTracking.createdAt, startDate), lte(eventTracking.createdAt, endDate))
    ).groupBy(eventTracking.eventType).orderBy(desc(count()));
    return results.map(r => ({ eventType: r.eventType, count: Number(r.count) }));
  }

  async submitAiFeedback(data: { messageId: string; conversationId: string; userId: string; rating: string; reason?: string }): Promise<AiFeedback> {
    const [feedback] = await db.insert(aiFeedback).values(data).returning();
    return feedback;
  }

  async getAiFeedbackStats(): Promise<{ positive: number; negative: number; total: number }> {
    const allFeedback = await db.select({ rating: aiFeedback.rating }).from(aiFeedback);
    const positive = allFeedback.filter(f => f.rating === 'positive').length;
    const negative = allFeedback.filter(f => f.rating === 'negative').length;
    return { positive, negative, total: allFeedback.length };
  }

  async createPlatformInsight(data: { insightType: string; category: string; title: string; description?: string; data?: Record<string, any>; severity?: string; isActionable?: boolean }): Promise<PlatformInsight> {
    const [insight] = await db.insert(platformInsights).values(data).returning();
    return insight;
  }

  async getPlatformInsights(limit = 50): Promise<PlatformInsight[]> {
    return db.select().from(platformInsights).orderBy(desc(platformInsights.createdAt)).limit(limit);
  }

  async getUnreadInsights(): Promise<PlatformInsight[]> {
    return db.select().from(platformInsights).where(eq(platformInsights.isRead, false)).orderBy(desc(platformInsights.createdAt));
  }

  async markInsightRead(id: string): Promise<void> {
    await db.update(platformInsights).set({ isRead: true }).where(eq(platformInsights.id, id));
  }

  async createFaqEntry(data: { question: string; answer: string; category: string }): Promise<FaqEntry> {
    const [entry] = await db.insert(faqEntries).values(data).returning();
    return entry;
  }

  async getFaqEntries(publishedOnly = false): Promise<FaqEntry[]> {
    if (publishedOnly) {
      return db.select().from(faqEntries).where(eq(faqEntries.isPublished, true)).orderBy(desc(faqEntries.sourceCount));
    }
    return db.select().from(faqEntries).orderBy(desc(faqEntries.sourceCount));
  }

  async updateFaqEntry(id: string, updates: Partial<{ question: string; answer: string; category: string; isPublished: boolean }>): Promise<FaqEntry> {
    const [entry] = await db.update(faqEntries).set({ ...updates, updatedAt: new Date() }).where(eq(faqEntries.id, id)).returning();
    return entry;
  }

  async upsertDemandHeatmap(data: { gridLat: string; gridLng: string; hourOfDay: number; dayOfWeek: number; rideCount: number; avgFare?: string; avgWaitTime?: number }): Promise<DemandHeatmapEntry> {
    const existing = await db.select().from(demandHeatmap).where(
      and(
        eq(demandHeatmap.gridLat, data.gridLat),
        eq(demandHeatmap.gridLng, data.gridLng),
        eq(demandHeatmap.hourOfDay, data.hourOfDay),
        eq(demandHeatmap.dayOfWeek, data.dayOfWeek)
      )
    );
    if (existing.length > 0) {
      const [updated] = await db.update(demandHeatmap).set({
        rideCount: (existing[0].rideCount || 0) + data.rideCount,
        avgFare: data.avgFare || existing[0].avgFare,
        avgWaitTime: data.avgWaitTime || existing[0].avgWaitTime,
        lastUpdated: new Date(),
      }).where(eq(demandHeatmap.id, existing[0].id)).returning();
      return updated;
    }
    const [entry] = await db.insert(demandHeatmap).values(data).returning();
    return entry;
  }

  async getDemandHeatmap(hourOfDay?: number, dayOfWeek?: number): Promise<DemandHeatmapEntry[]> {
    const conditions = [];
    if (hourOfDay !== undefined) conditions.push(eq(demandHeatmap.hourOfDay, hourOfDay));
    if (dayOfWeek !== undefined) conditions.push(eq(demandHeatmap.dayOfWeek, dayOfWeek));
    if (conditions.length > 0) {
      return db.select().from(demandHeatmap).where(and(...conditions)).orderBy(desc(demandHeatmap.rideCount));
    }
    return db.select().from(demandHeatmap).orderBy(desc(demandHeatmap.rideCount));
  }

  async upsertDriverScorecard(driverId: string): Promise<DriverScorecardEntry> {
    const completedRides = await db.select().from(rides).where(and(eq(rides.driverId, driverId), eq(rides.status, "completed")));
    const cancelledRides = await db.select().from(rides).where(and(eq(rides.driverId, driverId), eq(rides.status, "cancelled")));
    const allDriverRides = await db.select().from(rides).where(eq(rides.driverId, driverId));
    const driverDisputes = await db.select().from(disputes).where(eq(disputes.reporterId, driverId));
    const sosIncidents = await db.select().from(emergencyIncidents).where(eq(emergencyIncidents.userId, driverId));

    const totalCompleted = completedRides.length;
    const totalCancelled = cancelledRides.length;
    const totalAll = allDriverRides.length;
    const acceptanceRate = totalAll > 0 ? ((totalAll - totalCancelled) / totalAll * 100).toFixed(2) : "0.00";
    const completionRate = totalAll > 0 ? (totalCompleted / totalAll * 100).toFixed(2) : "0.00";

    const ratings = completedRides.map(r => r.driverRating).filter(Boolean) as number[];
    const avgRating = ratings.length > 0 ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(2) : "5.00";

    const totalEarnings = completedRides.reduce((sum, r) => sum + parseFloat(r.actualFare?.toString() || '0'), 0).toFixed(2);

    const peakHours: Record<string, number> = {};
    for (const ride of completedRides) {
      if (ride.startedAt) {
        const hour = new Date(ride.startedAt).getHours();
        peakHours[hour] = (peakHours[hour] || 0) + 1;
      }
    }

    const existing = await db.select().from(driverScorecard).where(eq(driverScorecard.driverId, driverId));
    const scorecardData = {
      totalRidesCompleted: totalCompleted,
      totalRidesCancelled: totalCancelled,
      acceptanceRate,
      completionRate,
      avgRating,
      totalEarnings,
      peakHoursWorked: peakHours,
      disputeCount: driverDisputes.length,
      sosCount: sosIncidents.length,
      lastUpdated: new Date(),
    };

    if (existing.length > 0) {
      const [updated] = await db.update(driverScorecard).set(scorecardData).where(eq(driverScorecard.driverId, driverId)).returning();
      return updated;
    }
    const [created] = await db.insert(driverScorecard).values({ driverId, ...scorecardData }).returning();
    return created;
  }

  async getDriverScorecard(driverId: string): Promise<DriverScorecardEntry | undefined> {
    const [scorecard] = await db.select().from(driverScorecard).where(eq(driverScorecard.driverId, driverId));
    return scorecard;
  }

  async getAllDriverScorecards(): Promise<DriverScorecardEntry[]> {
    return db.select().from(driverScorecard).orderBy(desc(driverScorecard.avgRating));
  }

  async createSafetyAlert(data: { alertType: string; severity: string; targetUserId?: string; title: string; description?: string; data?: Record<string, any> }): Promise<SafetyAlert> {
    const [alert] = await db.insert(safetyAlerts).values(data).returning();
    return alert;
  }

  async getActiveSafetyAlerts(): Promise<SafetyAlert[]> {
    return db.select().from(safetyAlerts).where(eq(safetyAlerts.isResolved, false)).orderBy(desc(safetyAlerts.createdAt));
  }

  async resolveSafetyAlert(id: string, resolvedBy: string): Promise<SafetyAlert> {
    const [alert] = await db.update(safetyAlerts).set({ isResolved: true, resolvedBy, resolvedAt: new Date() }).where(eq(safetyAlerts.id, id)).returning();
    return alert;
  }

  async getConversionMetrics(startDate: Date, endDate: Date): Promise<{ searches: number; bookings: number; completions: number; conversionRate: number }> {
    const searchEvents = await db.select({ count: count() }).from(eventTracking).where(
      and(eq(eventTracking.eventType, "ride_search"), gte(eventTracking.createdAt, startDate), lte(eventTracking.createdAt, endDate))
    );
    const bookingEvents = await db.select({ count: count() }).from(eventTracking).where(
      and(eq(eventTracking.eventType, "ride_booked"), gte(eventTracking.createdAt, startDate), lte(eventTracking.createdAt, endDate))
    );
    const completionEvents = await db.select({ count: count() }).from(eventTracking).where(
      and(eq(eventTracking.eventType, "ride_completed"), gte(eventTracking.createdAt, startDate), lte(eventTracking.createdAt, endDate))
    );
    const searches = Number(searchEvents[0]?.count || 0);
    const bookings = Number(bookingEvents[0]?.count || 0);
    const completions = Number(completionEvents[0]?.count || 0);
    return { searches, bookings, completions, conversionRate: searches > 0 ? (completions / searches * 100) : 0 };
  }

  async getDriverOptimalHours(driverId: string): Promise<{ hour: number; dayOfWeek: number; avgRides: number; avgEarnings: number }[]> {
    const completedRides = await db.select().from(rides).where(and(eq(rides.driverId, driverId), eq(rides.status, "completed")));
    const hourlyData: Record<string, { rides: number; earnings: number; weeks: Set<string> }> = {};

    for (const ride of completedRides) {
      if (!ride.startedAt) continue;
      const d = new Date(ride.startedAt);
      const key = `${d.getDay()}-${d.getHours()}`;
      const weekKey = `${d.getFullYear()}-W${Math.ceil(d.getDate() / 7)}`;
      if (!hourlyData[key]) hourlyData[key] = { rides: 0, earnings: 0, weeks: new Set() };
      hourlyData[key].rides += 1;
      hourlyData[key].earnings += parseFloat(ride.actualFare?.toString() || '0');
      hourlyData[key].weeks.add(weekKey);
    }

    return Object.entries(hourlyData).map(([key, data]) => {
      const [dayOfWeek, hour] = key.split('-').map(Number);
      const numWeeks = Math.max(data.weeks.size, 1);
      return { hour, dayOfWeek, avgRides: data.rides / numWeeks, avgEarnings: data.earnings / numWeeks };
    }).sort((a, b) => b.avgEarnings - a.avgEarnings);
  }

  // ── Ride groups ──────────────────────────────────────────────────────────────

  async createRideGroup(data: InsertRideGroup): Promise<RideGroup> {
    const [group] = await db.insert(rideGroups).values(data).returning();
    return group;
  }

  async getRideGroupByCode(code: string): Promise<RideGroup | undefined> {
    const [group] = await db.select().from(rideGroups).where(eq(rideGroups.scheduleCode, code));
    return group;
  }

  async getRideGroupById(id: string): Promise<RideGroup | undefined> {
    const [group] = await db.select().from(rideGroups).where(eq(rideGroups.id, id));
    return group;
  }

  async updateRideGroup(id: string, updates: Partial<RideGroup>): Promise<RideGroup> {
    const [group] = await db.update(rideGroups).set(updates).where(eq(rideGroups.id, id)).returning();
    return group;
  }

  async getRidesInGroup(groupId: string): Promise<Ride[]> {
    return await db.select().from(rides).where(eq(rides.groupId, groupId));
  }

  async applyGroupDiscount(groupId: string, discountPct: number): Promise<void> {
    const groupRides = await this.getRidesInGroup(groupId);
    const multiplier = (100 - discountPct) / 100;
    await Promise.all(
      groupRides.map(async (ride) => {
        const original = parseFloat(ride.estimatedFare || "0");
        const discounted = original * multiplier;
        const discount = original - discounted;
        await db.update(rides).set({
          originalFare: original.toFixed(2),
          estimatedFare: discounted.toFixed(2),
          groupDiscountAmount: discount.toFixed(2),
          updatedAt: new Date(),
        }).where(eq(rides.id, ride.id));
      })
    );
    await db.update(rideGroups).set({ discountActive: true }).where(eq(rideGroups.id, groupId));
  }
}

export const storage = new DatabaseStorage();
