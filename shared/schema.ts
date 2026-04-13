import { sql, relations } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgTable,
  timestamp,
  varchar,
  text,
  decimal,
  boolean,
  integer,
  pgEnum,
  date,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Session storage table (required for Replit Auth)
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// User storage table (required for Replit Auth)
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  password: varchar("password"),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  phone: varchar("phone"),
  isDriver: boolean("is_driver").default(false),
  isVerified: boolean("is_verified").default(false),
  isAdmin: boolean("is_admin").default(false),
  isSuperAdmin: boolean("is_super_admin").default(false),
  isApproved: boolean("is_approved").default(false),
  approvedBy: varchar("approved_by"),
  isSuspended: boolean("is_suspended").default(false),
  rating: decimal("rating", { precision: 3, scale: 2 }).default("5.00"),
  totalRides: integer("total_rides").default(0),
  emergencyContact: varchar("emergency_contact"),
  stripeCustomerId: varchar("stripe_customer_id"),
  stripePaymentMethodId: varchar("stripe_payment_method_id"),
  virtualCardBalance: decimal("virtual_card_balance", { precision: 10, scale: 2 }).default("0.00"),
  promoRidesRemaining: integer("promo_rides_remaining").default(0),
  passwordResetToken: varchar("password_reset_token"),
  passwordResetExpiry: timestamp("password_reset_expiry"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Driver profiles
export const driverProfiles = pgTable("driver_profiles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  licenseNumber: varchar("license_number"),
  licenseImageUrl: varchar("license_image_url"),
  insuranceImageUrl: varchar("insurance_image_url"),
  isOnline: boolean("is_online").default(false),
  isVerifiedNeighbor: boolean("is_verified_neighbor").default(false),
  isSuspended: boolean("is_suspended").default(false),
  approvalStatus: varchar("approval_status").default("pending"),
  discountRate: decimal("discount_rate", { precision: 3, scale: 2 }).default("0.00"),
  currentLocation: jsonb("current_location").$type<{lat: number, lng: number}>(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Vehicle information
export const vehicles = pgTable("vehicles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  driverProfileId: varchar("driver_profile_id").notNull().references(() => driverProfiles.id),
  make: varchar("make").notNull(),
  model: varchar("model").notNull(),
  year: integer("year").notNull(),
  color: varchar("color").notNull(),
  licensePlate: varchar("license_plate").notNull(),
  photos: jsonb("photos").$type<string[]>().default([]),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Ride status enum
export const rideStatusEnum = pgEnum("ride_status", [
  "pending",
  "accepted",
  "driver_arriving",
  "in_progress",
  "completed",
  "cancelled"
]);

// Payment status enum
export const paymentStatusEnum = pgEnum("payment_status", [
  "pending_payment",
  "authorized",
  "paid_card",
  "paid_cash",
  "cancelled_with_fee",
  "cancelled",
  "disputed"
]);

// Payment method enum
export const paymentMethodEnum = pgEnum("payment_method", [
  "cash",
  "card"
]);

// Ownership status enum
export const ownershipStatusEnum = pgEnum("ownership_status", [
  "none",
  "ad_hoc",
  "lifetime"
]);

// Share certificate status enum
export const shareCertStatusEnum = pgEnum("share_cert_status", [
  "active",
  "revoked",
  "transferred"
]);

// Profit declaration status enum
export const profitDeclStatusEnum = pgEnum("profit_decl_status", [
  "draft",
  "declared",
  "distributed"
]);

// Rides table
export const rides = pgTable("rides", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  riderId: varchar("rider_id").notNull().references(() => users.id),
  driverId: varchar("driver_id").references(() => users.id),
  pickupLocation: jsonb("pickup_location").$type<{lat: number, lng: number, address: string}>().notNull(),
  destinationLocation: jsonb("destination_location").$type<{lat: number, lng: number, address: string}>().notNull(),
  pickupInstructions: text("pickup_instructions"),
  status: rideStatusEnum("status").default("pending"),
  paymentMethod: paymentMethodEnum("payment_method").default("cash"),
  estimatedFare: decimal("estimated_fare", { precision: 8, scale: 2 }),
  actualFare: decimal("actual_fare", { precision: 8, scale: 2 }),
  distance: decimal("distance", { precision: 8, scale: 2 }),
  duration: integer("duration"),
  tipAmount: decimal("tip_amount", { precision: 8, scale: 2 }).default("0.00"),
  paymentStatus: paymentStatusEnum("payment_status").default("pending_payment"),
  stripePaymentIntentId: varchar("stripe_payment_intent_id"),
  refundedAmount: decimal("refunded_amount", { precision: 8, scale: 2 }),
  cancellationFee: decimal("cancellation_fee", { precision: 8, scale: 2 }),
  cancellationReason: text("cancellation_reason"),
  driverTraveledDistance: decimal("driver_traveled_distance", { precision: 8, scale: 2 }),
  driverTraveledTime: integer("driver_traveled_time"),
  routePath: jsonb("route_path").$type<Array<{lat: number, lng: number, timestamp: number}>>(),
  cashReceivedAt: timestamp("cash_received_at"),
  paidBy: varchar("paid_by").references(() => users.id),
  riderRating: integer("rider_rating"),
  driverRating: integer("driver_rating"),
  riderReview: text("rider_review"),
  driverReview: text("driver_review"),
  scheduledAt: timestamp("scheduled_at"),
  sharedRideGroupId: varchar("shared_ride_group_id"),
  promoDiscountApplied: decimal("promo_discount_applied", { precision: 8, scale: 2 }).default("0.00"),
  acceptedAt: timestamp("accepted_at"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Shared ride groups (cluster scheduling)
export const sharedRideGroups = pgTable("shared_ride_groups", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  scheduledAt: timestamp("scheduled_at").notNull(),
  destinationLabel: varchar("destination_label").notNull(),
  destinationLat: decimal("destination_lat", { precision: 10, scale: 6 }).notNull(),
  destinationLng: decimal("destination_lng", { precision: 10, scale: 6 }).notNull(),
  radiusMiles: decimal("radius_miles", { precision: 4, scale: 2 }).default("2.00"),
  maxRiders: integer("max_riders").default(4),
  riderCount: integer("rider_count").default(0),
  status: varchar("status").default("open"),
  driverId: varchar("driver_id").references(() => users.id),
  discountPct: integer("discount_pct").default(30),
  createdBy: varchar("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Driver payout requests
export const payoutRequests = pgTable("payout_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  driverId: varchar("driver_id").notNull().references(() => users.id),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  payoutMethod: varchar("payout_method").notNull(), // 'zelle' | 'cashapp' | 'paypal' | 'check'
  payoutDetails: varchar("payout_details").notNull(), // phone/email/address for payout
  status: varchar("status").default("pending"), // 'pending' | 'processing' | 'paid' | 'rejected'
  adminNote: text("admin_note"),
  processedBy: varchar("processed_by").references(() => users.id),
  processedAt: timestamp("processed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Dispute reports
export const disputes = pgTable("disputes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  rideId: varchar("ride_id").notNull().references(() => rides.id),
  reporterId: varchar("reporter_id").notNull().references(() => users.id),
  issueType: varchar("issue_type").notNull(),
  description: text("description").notNull(),
  status: varchar("status").default("pending"),
  resolution: text("resolution"),
  resolvedBy: varchar("resolved_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Emergency incidents
export const emergencyIncidents = pgTable("emergency_incidents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  rideId: varchar("ride_id").references(() => rides.id),
  incidentType: varchar("incident_type").notNull(),
  location: jsonb("location").$type<{lat: number, lng: number}>(),
  description: text("description"),
  status: varchar("status").default("active"),
  shareToken: varchar("share_token").unique(),
  emergencyContactAlerted: boolean("emergency_contact_alerted").default(false),
  lastLocationUpdate: timestamp("last_location_update"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ============================================================
// OWNERSHIP & BACK OFFICE TABLES
// ============================================================

// Weekly driving hours log - tracks hours per driver per week
export const driverWeeklyHours = pgTable("driver_weekly_hours", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  driverId: varchar("driver_id").notNull().references(() => users.id),
  weekStart: date("week_start").notNull(),
  totalMinutes: integer("total_minutes").default(0),
  rideCount: integer("ride_count").default(0),
  qualifiesWeek: boolean("qualifies_week").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

// Driver ownership status - tracks qualification progress
export const driverOwnership = pgTable("driver_ownership", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  driverId: varchar("driver_id").notNull().references(() => users.id).unique(),
  status: ownershipStatusEnum("status").default("none"),
  totalQualifyingWeeks: integer("total_qualifying_weeks").default(0),
  totalLifetimeMinutes: integer("total_lifetime_minutes").default(0),
  year1Minutes: integer("year1_minutes").default(0),
  year2Minutes: integer("year2_minutes").default(0),
  year3Minutes: integer("year3_minutes").default(0),
  year4Minutes: integer("year4_minutes").default(0),
  year5Minutes: integer("year5_minutes").default(0),
  trackingStartDate: timestamp("tracking_start_date"),
  adHocQualificationDate: timestamp("ad_hoc_qualification_date"),
  lifetimeQualificationDate: timestamp("lifetime_qualification_date"),
  graceDeadline: timestamp("grace_deadline"),
  ratingAtQualification: decimal("rating_at_qualification", { precision: 3, scale: 2 }),
  backgroundCheckStatus: varchar("background_check_status").default("pending"),
  backgroundCheckDate: timestamp("background_check_date"),
  hasAdverseRecord: boolean("has_adverse_record").default(false),
  violationNotes: text("violation_notes"),
  removedFromDriving: boolean("removed_from_driving").default(false),
  removalReason: text("removal_reason"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Share certificates - issued to qualifying drivers
export const shareCertificates = pgTable("share_certificates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ownerId: varchar("owner_id").notNull().references(() => users.id),
  ownershipId: varchar("ownership_id").notNull().references(() => driverOwnership.id),
  certificateNumber: varchar("certificate_number").notNull().unique(),
  sharePercentage: decimal("share_percentage", { precision: 8, scale: 4 }),
  status: shareCertStatusEnum("status").default("active"),
  issuedAt: timestamp("issued_at").defaultNow(),
  revokedAt: timestamp("revoked_at"),
  revokeReason: text("revoke_reason"),
  transferredTo: varchar("transferred_to").references(() => users.id),
  transferredAt: timestamp("transferred_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Ownership rebalance log - audit trail of share redistributions
export const ownershipRebalanceLog = pgTable("ownership_rebalance_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  eventType: varchar("event_type").notNull(),
  triggeredBy: varchar("triggered_by").references(() => users.id),
  affectedDriverId: varchar("affected_driver_id").references(() => users.id),
  previousSnapshot: jsonb("previous_snapshot").$type<Record<string, number>>(),
  newSnapshot: jsonb("new_snapshot").$type<Record<string, number>>(),
  totalActiveOwners: integer("total_active_owners").default(0),
  driverPoolPercentage: decimal("driver_pool_percentage", { precision: 5, scale: 2 }).default("49.00"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Profit declarations - yearly profit declared by admin/board
export const profitDeclarations = pgTable("profit_declarations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  fiscalYear: integer("fiscal_year").notNull(),
  totalRevenue: decimal("total_revenue", { precision: 12, scale: 2 }),
  totalExpenses: decimal("total_expenses", { precision: 12, scale: 2 }),
  netProfit: decimal("net_profit", { precision: 12, scale: 2 }),
  distributableProfit: decimal("distributable_profit", { precision: 12, scale: 2 }),
  status: profitDeclStatusEnum("status").default("draft"),
  declaredBy: varchar("declared_by").references(() => users.id),
  declaredAt: timestamp("declared_at"),
  distributedAt: timestamp("distributed_at"),
  boardNotes: text("board_notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Profit distributions - individual payouts to owners
export const profitDistributions = pgTable("profit_distributions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  declarationId: varchar("declaration_id").notNull().references(() => profitDeclarations.id),
  ownerId: varchar("owner_id").notNull().references(() => users.id),
  sharePercentage: decimal("share_percentage", { precision: 8, scale: 4 }),
  ownershipType: ownershipStatusEnum("ownership_type"),
  amount: decimal("amount", { precision: 12, scale: 2 }),
  status: varchar("status").default("pending"),
  paidAt: timestamp("paid_at"),
  paymentMethod: varchar("payment_method"),
  paymentReference: varchar("payment_reference"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Admin activity log - audit trail for admin actions
export const adminActivityLog = pgTable("admin_activity_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  adminId: varchar("admin_id").notNull().references(() => users.id),
  action: varchar("action").notNull(),
  targetType: varchar("target_type"),
  targetId: varchar("target_id"),
  details: jsonb("details").$type<Record<string, any>>(),
  createdAt: timestamp("created_at").defaultNow(),
});

// ============================================================
// RELATIONS
// ============================================================

export const usersRelations = relations(users, ({ one, many }) => ({
  driverProfile: one(driverProfiles, {
    fields: [users.id],
    references: [driverProfiles.userId],
  }),
  ridesAsRider: many(rides, { relationName: "rider" }),
  ridesAsDriver: many(rides, { relationName: "driver" }),
  disputes: many(disputes),
  emergencyIncidents: many(emergencyIncidents),
  ownership: one(driverOwnership, {
    fields: [users.id],
    references: [driverOwnership.driverId],
  }),
  shareCertificates: many(shareCertificates),
  profitDistributions: many(profitDistributions),
}));

export const driverProfilesRelations = relations(driverProfiles, ({ one, many }) => ({
  user: one(users, {
    fields: [driverProfiles.userId],
    references: [users.id],
  }),
  vehicles: many(vehicles),
}));

export const vehiclesRelations = relations(vehicles, ({ one }) => ({
  driverProfile: one(driverProfiles, {
    fields: [vehicles.driverProfileId],
    references: [driverProfiles.id],
  }),
}));

export const ridesRelations = relations(rides, ({ one, many }) => ({
  rider: one(users, {
    fields: [rides.riderId],
    references: [users.id],
    relationName: "rider",
  }),
  driver: one(users, {
    fields: [rides.driverId],
    references: [users.id],
    relationName: "driver",
  }),
  disputes: many(disputes),
}));

export const disputesRelations = relations(disputes, ({ one }) => ({
  ride: one(rides, {
    fields: [disputes.rideId],
    references: [rides.id],
  }),
  reporter: one(users, {
    fields: [disputes.reporterId],
    references: [users.id],
  }),
}));

export const emergencyIncidentsRelations = relations(emergencyIncidents, ({ one }) => ({
  user: one(users, {
    fields: [emergencyIncidents.userId],
    references: [users.id],
  }),
  ride: one(rides, {
    fields: [emergencyIncidents.rideId],
    references: [rides.id],
  }),
}));

export const driverOwnershipRelations = relations(driverOwnership, ({ one, many }) => ({
  driver: one(users, {
    fields: [driverOwnership.driverId],
    references: [users.id],
  }),
  certificates: many(shareCertificates),
}));

export const shareCertificatesRelations = relations(shareCertificates, ({ one }) => ({
  owner: one(users, {
    fields: [shareCertificates.ownerId],
    references: [users.id],
  }),
  ownership: one(driverOwnership, {
    fields: [shareCertificates.ownershipId],
    references: [driverOwnership.id],
  }),
}));

export const profitDeclarationsRelations = relations(profitDeclarations, ({ many }) => ({
  distributions: many(profitDistributions),
}));

export const profitDistributionsRelations = relations(profitDistributions, ({ one }) => ({
  declaration: one(profitDeclarations, {
    fields: [profitDistributions.declarationId],
    references: [profitDeclarations.id],
  }),
  owner: one(users, {
    fields: [profitDistributions.ownerId],
    references: [users.id],
  }),
}));

export const driverWeeklyHoursRelations = relations(driverWeeklyHours, ({ one }) => ({
  driver: one(users, {
    fields: [driverWeeklyHours.driverId],
    references: [users.id],
  }),
}));

// AI Assistant conversations
export const conversations = pgTable("conversations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  title: text("title").notNull().default("New Chat"),
  createdAt: timestamp("created_at").defaultNow(),
});

// AI Assistant messages
export const chatMessages = pgTable("chat_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  conversationId: varchar("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  role: varchar("role").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  user: one(users, {
    fields: [conversations.userId],
    references: [users.id],
  }),
  messages: many(chatMessages),
}));

export const chatMessagesRelations = relations(chatMessages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [chatMessages.conversationId],
    references: [conversations.id],
  }),
}));

// ============================================================
// DRIVER RATE CARDS
// ============================================================

export const driverRateCards = pgTable("driver_rate_cards", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  driverId: varchar("driver_id").notNull().references(() => users.id).unique(),
  minimumFare: decimal("minimum_fare", { precision: 8, scale: 2 }).default("7.65"),
  baseFare: decimal("base_fare", { precision: 8, scale: 2 }).default("4.00"),
  perMinuteRate: decimal("per_minute_rate", { precision: 8, scale: 4 }).default("0.2900"),
  perMileRate: decimal("per_mile_rate", { precision: 8, scale: 4 }).default("0.9000"),
  surgeAdjustment: decimal("surge_adjustment", { precision: 8, scale: 2 }).default("0.00"),
  useSuggested: boolean("use_suggested").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const driverRateCardsRelations = relations(driverRateCards, ({ one }) => ({
  driver: one(users, {
    fields: [driverRateCards.driverId],
    references: [users.id],
  }),
}));

// ============================================================
// ANALYTICS & SELF-LEARNING TABLES
// ============================================================

export const eventTracking = pgTable("event_tracking", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id),
  eventType: varchar("event_type").notNull(),
  eventCategory: varchar("event_category").notNull(),
  eventData: jsonb("event_data").$type<Record<string, any>>(),
  sessionId: varchar("session_id"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_event_type").on(table.eventType),
  index("idx_event_category").on(table.eventCategory),
  index("idx_event_created").on(table.createdAt),
]);

export const aiFeedback = pgTable("ai_feedback", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  messageId: varchar("message_id").notNull().references(() => chatMessages.id, { onDelete: "cascade" }),
  conversationId: varchar("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id),
  rating: varchar("rating").notNull(),
  reason: text("reason"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const platformInsights = pgTable("platform_insights", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  insightType: varchar("insight_type").notNull(),
  category: varchar("category").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  data: jsonb("data").$type<Record<string, any>>(),
  severity: varchar("severity").default("info"),
  isRead: boolean("is_read").default(false),
  isActionable: boolean("is_actionable").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const faqEntries = pgTable("faq_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  question: text("question").notNull(),
  answer: text("answer").notNull(),
  category: varchar("category").notNull(),
  sourceCount: integer("source_count").default(1),
  isPublished: boolean("is_published").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const demandHeatmap = pgTable("demand_heatmap", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  gridLat: decimal("grid_lat", { precision: 10, scale: 6 }).notNull(),
  gridLng: decimal("grid_lng", { precision: 10, scale: 6 }).notNull(),
  hourOfDay: integer("hour_of_day").notNull(),
  dayOfWeek: integer("day_of_week").notNull(),
  rideCount: integer("ride_count").default(0),
  avgFare: decimal("avg_fare", { precision: 8, scale: 2 }),
  avgWaitTime: integer("avg_wait_time"),
  lastUpdated: timestamp("last_updated").defaultNow(),
});

export const driverScorecard = pgTable("driver_scorecard", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  driverId: varchar("driver_id").notNull().references(() => users.id).unique(),
  totalRidesCompleted: integer("total_rides_completed").default(0),
  totalRidesCancelled: integer("total_rides_cancelled").default(0),
  acceptanceRate: decimal("acceptance_rate", { precision: 5, scale: 2 }).default("0.00"),
  completionRate: decimal("completion_rate", { precision: 5, scale: 2 }).default("0.00"),
  avgRating: decimal("avg_rating", { precision: 3, scale: 2 }).default("5.00"),
  avgResponseTime: integer("avg_response_time"),
  totalEarnings: decimal("total_earnings", { precision: 12, scale: 2 }).default("0.00"),
  peakHoursWorked: jsonb("peak_hours_worked").$type<Record<string, number>>(),
  bestZones: jsonb("best_zones").$type<Array<{lat: number, lng: number, count: number}>>(),
  disputeCount: integer("dispute_count").default(0),
  sosCount: integer("sos_count").default(0),
  lastUpdated: timestamp("last_updated").defaultNow(),
});

export const safetyAlerts = pgTable("safety_alerts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  alertType: varchar("alert_type").notNull(),
  severity: varchar("severity").notNull(),
  targetUserId: varchar("target_user_id").references(() => users.id),
  title: text("title").notNull(),
  description: text("description"),
  data: jsonb("data").$type<Record<string, any>>(),
  isResolved: boolean("is_resolved").default(false),
  resolvedBy: varchar("resolved_by").references(() => users.id),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const eventTrackingRelations = relations(eventTracking, ({ one }) => ({
  user: one(users, {
    fields: [eventTracking.userId],
    references: [users.id],
  }),
}));

export const aiFeedbackRelations = relations(aiFeedback, ({ one }) => ({
  message: one(chatMessages, {
    fields: [aiFeedback.messageId],
    references: [chatMessages.id],
  }),
  conversation: one(conversations, {
    fields: [aiFeedback.conversationId],
    references: [conversations.id],
  }),
  user: one(users, {
    fields: [aiFeedback.userId],
    references: [users.id],
  }),
}));

export const driverScorecardRelations = relations(driverScorecard, ({ one }) => ({
  driver: one(users, {
    fields: [driverScorecard.driverId],
    references: [users.id],
  }),
}));

export const safetyAlertsRelations = relations(safetyAlerts, ({ one }) => ({
  targetUser: one(users, {
    fields: [safetyAlerts.targetUserId],
    references: [users.id],
  }),
}));

// ============================================================
// ZOD SCHEMAS
// ============================================================

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertDriverProfileSchema = createInsertSchema(driverProfiles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertVehicleSchema = createInsertSchema(vehicles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertRideSchema = createInsertSchema(rides).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertDisputeSchema = createInsertSchema(disputes).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertEmergencyIncidentSchema = createInsertSchema(emergencyIncidents).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertDriverWeeklyHoursSchema = createInsertSchema(driverWeeklyHours).omit({
  id: true,
  createdAt: true,
});

export const insertDriverOwnershipSchema = createInsertSchema(driverOwnership).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertShareCertificateSchema = createInsertSchema(shareCertificates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertProfitDeclarationSchema = createInsertSchema(profitDeclarations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertProfitDistributionSchema = createInsertSchema(profitDistributions).omit({
  id: true,
  createdAt: true,
});

export const insertAdminActivityLogSchema = createInsertSchema(adminActivityLog).omit({
  id: true,
  createdAt: true,
});

export const insertEventTrackingSchema = createInsertSchema(eventTracking).omit({
  id: true,
  createdAt: true,
});

export const insertAiFeedbackSchema = createInsertSchema(aiFeedback).omit({
  id: true,
  createdAt: true,
});

export const insertPlatformInsightSchema = createInsertSchema(platformInsights).omit({
  id: true,
  createdAt: true,
});

export const insertFaqEntrySchema = createInsertSchema(faqEntries).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertSafetyAlertSchema = createInsertSchema(safetyAlerts).omit({
  id: true,
  createdAt: true,
});

export const insertDriverRateCardSchema = createInsertSchema(driverRateCards).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// ============================================================
// TYPES
// ============================================================

export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;
export type DriverProfile = typeof driverProfiles.$inferSelect;
export type Vehicle = typeof vehicles.$inferSelect;
export type Ride = typeof rides.$inferSelect;
export type Dispute = typeof disputes.$inferSelect;
export type EmergencyIncident = typeof emergencyIncidents.$inferSelect;
export type DriverWeeklyHours = typeof driverWeeklyHours.$inferSelect;
export type DriverOwnership = typeof driverOwnership.$inferSelect;
export type ShareCertificate = typeof shareCertificates.$inferSelect;
export type OwnershipRebalanceLog = typeof ownershipRebalanceLog.$inferSelect;
export type ProfitDeclaration = typeof profitDeclarations.$inferSelect;
export type ProfitDistribution = typeof profitDistributions.$inferSelect;
export type AdminActivityLog = typeof adminActivityLog.$inferSelect;

export const insertPayoutRequestSchema = createInsertSchema(payoutRequests).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  processedAt: true,
  processedBy: true,
  adminNote: true,
  status: true,
});
export type InsertPayoutRequest = z.infer<typeof insertPayoutRequestSchema>;
export type PayoutRequest = typeof payoutRequests.$inferSelect;

export const insertSharedRideGroupSchema = createInsertSchema(sharedRideGroups).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertSharedRideGroup = z.infer<typeof insertSharedRideGroupSchema>;
export type SharedRideGroup = typeof sharedRideGroups.$inferSelect;

export type InsertDriverProfile = z.infer<typeof insertDriverProfileSchema>;
export type InsertVehicle = z.infer<typeof insertVehicleSchema>;
export type InsertRide = z.infer<typeof insertRideSchema>;
export type InsertDispute = z.infer<typeof insertDisputeSchema>;
export type InsertEmergencyIncident = z.infer<typeof insertEmergencyIncidentSchema>;
export type InsertDriverWeeklyHours = z.infer<typeof insertDriverWeeklyHoursSchema>;
export type InsertDriverOwnership = z.infer<typeof insertDriverOwnershipSchema>;
export type InsertShareCertificate = z.infer<typeof insertShareCertificateSchema>;
export type InsertProfitDeclaration = z.infer<typeof insertProfitDeclarationSchema>;
export type InsertProfitDistribution = z.infer<typeof insertProfitDistributionSchema>;
export type InsertAdminActivityLog = z.infer<typeof insertAdminActivityLogSchema>;

export type Conversation = typeof conversations.$inferSelect;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type EventTracking = typeof eventTracking.$inferSelect;
export type AiFeedback = typeof aiFeedback.$inferSelect;
export type PlatformInsight = typeof platformInsights.$inferSelect;
export type FaqEntry = typeof faqEntries.$inferSelect;
export type DemandHeatmapEntry = typeof demandHeatmap.$inferSelect;
export type DriverScorecardEntry = typeof driverScorecard.$inferSelect;
export type SafetyAlert = typeof safetyAlerts.$inferSelect;

export type InsertEventTracking = z.infer<typeof insertEventTrackingSchema>;
export type InsertAiFeedback = z.infer<typeof insertAiFeedbackSchema>;
export type InsertPlatformInsight = z.infer<typeof insertPlatformInsightSchema>;
export type InsertFaqEntry = z.infer<typeof insertFaqEntrySchema>;
export type InsertSafetyAlert = z.infer<typeof insertSafetyAlertSchema>;

export type DriverRateCard = typeof driverRateCards.$inferSelect;
export type InsertDriverRateCard = z.infer<typeof insertDriverRateCardSchema>;
