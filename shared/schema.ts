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

// All Maryland counties + Baltimore City (used for driver county preference)
export const MD_COUNTIES = [
  "Allegany County",
  "Anne Arundel County",
  "Baltimore City",
  "Baltimore County",
  "Calvert County",
  "Caroline County",
  "Carroll County",
  "Cecil County",
  "Charles County",
  "Dorchester County",
  "Frederick County",
  "Garrett County",
  "Harford County",
  "Howard County",
  "Kent County",
  "Montgomery County",
  "Prince George's County",
  "Queen Anne's County",
  "Somerset County",
  "St. Mary's County",
  "Talbot County",
  "Washington County",
  "Wicomico County",
  "Worcester County",
] as const;

export type MdCounty = typeof MD_COUNTIES[number];

// Session storage table (required for session-based auth)
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// User storage table
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  password: varchar("password"),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  phone: varchar("phone"),
  isDriver: boolean("is_driver").default(false),
  // Admin-granted "trusted community member" badge surfaced as ✓ Verified on
  // the profile (client/src/pages/Profile.tsx). Distinct from emailVerifiedAt
  // (the timestamp of the email-click verification step at signup) — the
  // audit flagged this as a confusing pair, so flagging the difference here.
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
  // Email verification
  emailVerificationToken: varchar("email_verification_token"),
  emailVerificationExpiry: timestamp("email_verification_expiry"),
  emailVerifiedAt: timestamp("email_verified_at"),
  // Registration & consent tracking
  registrationCompletedAt: timestamp("registration_completed_at"),
  termsAcceptedAt: timestamp("terms_accepted_at"),
  privacyAcceptedAt: timestamp("privacy_accepted_at"),
  // Activity tracking
  lastLoginAt: timestamp("last_login_at"),
  // Per-account login throttling (R-L5). failedLoginAttempts increments on
  // each wrong password and resets on success; once it crosses the threshold
  // (5) we set lockoutUntil and refuse logins until that timestamp passes.
  // IP-based rate limiting (authLimiter) protects the endpoint; this protects
  // a specific account from credential-stuffing across IPs.
  failedLoginAttempts: integer("failed_login_attempts").default(0),
  lockoutUntil: timestamp("lockout_until"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_users_created_at").on(table.createdAt),
]);

// Driver profiles
export const driverProfiles = pgTable("driver_profiles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  licenseNumber: varchar("license_number"),
  licenseImageUrl: varchar("license_image_url"),
  insuranceImageUrl: varchar("insurance_image_url"),
  // Vehicle photos uploaded during onboarding before a vehicles row is created
  // (vehicle make/model/year/etc are captured separately during admin review).
  vehiclePhotoUrls: jsonb("vehicle_photo_urls").$type<string[]>().default([]),
  isOnline: boolean("is_online").default(false),
  isVerifiedNeighbor: boolean("is_verified_neighbor").default(false),
  isSuspended: boolean("is_suspended").default(false),
  approvalStatus: varchar("approval_status").default("pending"),
  discountRate: decimal("discount_rate", { precision: 3, scale: 2 }).default("0.00"),
  currentLocation: jsonb("current_location").$type<{lat: number, lng: number}>(),
  // Counties this driver accepts rides in. Empty array = all Maryland counties accepted.
  acceptedCounties: text("accepted_counties").array().notNull().default(sql`ARRAY[]::text[]`),
  // Daily session — cleared when driver goes offline or at midnight
  dailyCounties: text("daily_counties").array(),
  dailySessionStart: timestamp("daily_session_start"),
  // Background check identifiers (Checkr)
  checkrCandidateId: varchar("checkr_candidate_id"),
  checkrReportId: varchar("checkr_report_id"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_driver_profiles_user_id").on(table.userId),
  index("idx_driver_profiles_is_online").on(table.isOnline),
  index("idx_driver_profiles_approval_status").on(table.approvalStatus),
]);

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
  /** Phase F4 — EV fleet incentives */
  isEv: boolean("is_ev").default(false),
  fuelType: varchar("fuel_type").default("gas"),
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
  virtualAmountAuthorized: decimal("virtual_amount_authorized", { precision: 8, scale: 2 }).default("0.00"),
  stripeAuthorizedAmount: decimal("stripe_authorized_amount", { precision: 8, scale: 2 }).default("0.00"),
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
  pickupCounty: varchar("pickup_county"),
  sharedRideGroupId: varchar("shared_ride_group_id"),
  wantsSharedRide: boolean("wants_shared_ride").default(false),
  sharedFareDiscount: decimal("shared_fare_discount", { precision: 8, scale: 2 }).default("0.00"),
  groupId: varchar("group_id"),
  rideType: varchar("ride_type").default("solo"),
  pickupStops: jsonb("pickup_stops").$type<Array<{lat: number, lng: number, address: string}>>(),
  originalFare: decimal("original_fare", { precision: 8, scale: 2 }),
  groupDiscountAmount: decimal("group_discount_amount", { precision: 8, scale: 2 }).default("0.00"),
  promoDiscountApplied: decimal("promo_discount_applied", { precision: 8, scale: 2 }).default("0.00"),
  acceptedAt: timestamp("accepted_at"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_rides_rider_id").on(table.riderId),
  index("idx_rides_driver_id").on(table.driverId),
  index("idx_rides_status").on(table.status),
  index("idx_rides_created_at").on(table.createdAt),
]);

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

// Ride groups — for Mode 3 (multi-stop, organizer pays) and Mode 4 (code-based shared schedule)
export const rideGroups = pgTable("ride_groups", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  scheduleCode: varchar("schedule_code", { length: 12 }).unique(),
  organizerId: varchar("organizer_id").notNull().references(() => users.id),
  groupType: varchar("group_type").notNull(),
  sharedDestination: jsonb("shared_destination").$type<{lat: number, lng: number, address: string}>(),
  maxSlots: integer("max_slots").default(3),
  filledSlots: integer("filled_slots").default(1),
  status: varchar("status").default("open"),
  driverId: varchar("driver_id").references(() => users.id),
  discountActive: boolean("discount_active").default(false),
  scheduledAt: timestamp("scheduled_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Push notification subscriptions
export const pushSubscriptions = pgTable("push_subscriptions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
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
}, (table) => [
  // AH-062: a given (declaration, owner) pair must be unique so a re-invoked
  // distributeProfits() can't insert duplicates. Combined with a transaction
  // wrapper and an explicit duplicate check this makes the function safe to
  // retry after a partial crash.
  index("idx_profit_distributions_declaration_owner_unique")
    .on(table.declarationId, table.ownerId),
]);

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

// Immutable ledger of every virtual card balance change
export const walletTransactions = pgTable("wallet_transactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(), // positive = credit, negative = debit
  balanceAfter: decimal("balance_after", { precision: 10, scale: 2 }).notNull(),
  reason: varchar("reason", { length: 100 }).notNull(), // e.g. 'ride_charge', 'tip', 'refund', 'topup', 'payout', 'dispute_refund'
  rideId: varchar("ride_id"),
  disputeId: varchar("dispute_id"),
  performedBy: varchar("performed_by"), // admin userId if manually adjusted
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_wallet_user_created").on(table.userId, table.createdAt),
]);

// AH-065: idempotency log for incoming webhooks. Stripe (and Checkr) retry
// delivery on any non-2xx response or network timeout; without this table
// a successful-but-slow handler could be invoked multiple times and apply
// the same state transition repeatedly (e.g. paying a driver twice on
// charge.refunded). Unique constraint on (provider, event_id) makes the
// INSERT itself the locking primitive — try-insert-then-process means a
// duplicate gets rejected before any side effects fire.
export const processedWebhookEvents = pgTable("processed_webhook_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  provider: varchar("provider").notNull(), // 'stripe' | 'checkr'
  eventId: varchar("event_id").notNull(),
  eventType: varchar("event_type"),
  processedAt: timestamp("processed_at").defaultNow().notNull(),
}, (table) => [
  index("idx_processed_webhook_provider_event").on(table.provider, table.eventId),
]);

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

/** RAG knowledge base — FAQ, insights, policies indexed for AI assistant retrieval. */
export const knowledgeChunks = pgTable("knowledge_chunks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sourceType: varchar("source_type").notNull(),
  sourceId: varchar("source_id"),
  title: text("title").notNull(),
  content: text("content").notNull(),
  /** Hash-based embedding (384-dim); upgrade to external embed API when keyed. */
  embedding: jsonb("embedding").$type<number[]>(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_knowledge_source").on(table.sourceType, table.sourceId),
]);

/** In-app notification inbox (push is optional via VAPID). */
export const inAppNotifications = pgTable("in_app_notifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  type: varchar("type").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  data: jsonb("data").$type<Record<string, any>>(),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_in_app_notif_user").on(table.userId),
  index("idx_in_app_notif_created").on(table.createdAt),
]);

export const agentAuditLog = pgTable("agent_audit_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  agent: varchar("agent").notNull(),
  action: varchar("action").notNull(),
  userId: varchar("user_id").references(() => users.id),
  rideId: varchar("ride_id").references(() => rides.id),
  reasoning: text("reasoning"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").defaultNow(),
});

/** Autonomy dial — how much the orchestrator can do without confirmation (B5). */
export const userAutonomySettings = pgTable("user_autonomy_settings", {
  userId: varchar("user_id").primaryKey().references(() => users.id),
  autonomyLevel: integer("autonomy_level").default(1).notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

/** Parsed delegative intents from voice/text (B2). */
export const mobilityIntents = pgTable("mobility_intents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  intentType: varchar("intent_type").notNull(),
  utterance: text("utterance"),
  payload: jsonb("payload").$type<Record<string, unknown>>(),
  status: varchar("status").default("parsed"),
  createdAt: timestamp("created_at").defaultNow(),
});

/** Cached GenUI spec per active ride (B1). */
export const rideSurfaceCache = pgTable("ride_surface_cache", {
  rideId: varchar("ride_id").primaryKey().references(() => rides.id, { onDelete: "cascade" }),
  spec: jsonb("spec").$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

/** Saved ride templates — home, work, repeat (B4). */
export const rideTemplates = pgTable("ride_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  label: varchar("label").notNull(),
  pickup: jsonb("pickup").$type<{ lat: number; lng: number; address: string }>(),
  destination: jsonb("destination").$type<{ lat: number; lng: number; address: string }>().notNull(),
  isDefault: boolean("is_default").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

/** Guardian / family tracking share links (B7).
 *
 * Security model (post-supervisor review):
 *  - expires_at is NOT NULL. Server-enforced max of 7 days. A nullable
 *    expiry was a "link lives forever" footgun.
 *  - revoked_at supports soft-revocation. getGuardianLinkByToken filters
 *    on (expires_at > now AND revoked_at IS NULL) so a rider can kill
 *    a shared link immediately without waiting for the 24h TTL.
 *  - rider_user_id is indexed so the rider can list and revoke their
 *    own active links cheaply.
 */
export const guardianLinks = pgTable("guardian_links", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  riderUserId: varchar("rider_user_id").notNull().references(() => users.id),
  guardianName: varchar("guardian_name").notNull(),
  shareToken: varchar("share_token").notNull().unique(),
  activeRideId: varchar("active_ride_id").references(() => rides.id),
  expiresAt: timestamp("expires_at").notNull(),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_guardian_links_rider").on(table.riderUserId),
]);

/** Rider↔driver trust graph edges (C1). */
export const trustEdges = pgTable("trust_edges", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  riderId: varchar("rider_id").notNull().references(() => users.id),
  driverId: varchar("driver_id").notNull().references(() => users.id),
  edgeType: varchar("edge_type").notNull().default("rode_together"),
  rideCount: integer("ride_count").default(0),
  lastRideAt: timestamp("last_ride_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_trust_edges_rider").on(table.riderId),
  index("idx_trust_edges_driver").on(table.driverId),
]);

/** Rider favorite drivers (C3). */
export const favoriteDrivers = pgTable("favorite_drivers", {
  riderId: varchar("rider_id").notNull().references(() => users.id),
  driverId: varchar("driver_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_favorite_drivers_rider").on(table.riderId),
]);

/** Rider trust matching preferences (C3). */
export const riderTrustPreferences = pgTable("rider_trust_preferences", {
  userId: varchar("user_id").primaryKey().references(() => users.id),
  /** 0 = open, 1 = rode together only, 2 = within 2 degrees */
  maxSeparationDegrees: integer("max_separation_degrees").default(0).notNull(),
  preferFavorites: boolean("prefer_favorites").default(true),
  updatedAt: timestamp("updated_at").defaultNow(),
});

/** Community referral chains (C4). */
export const communityReferrals = pgTable("community_referrals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  referrerId: varchar("referrer_id").notNull().references(() => users.id),
  referredId: varchar("referred_id").references(() => users.id),
  referralCode: varchar("referral_code").notNull().unique(),
  chainType: varchar("chain_type").notNull(),
  status: varchar("status").default("pending"),
  creditAmount: decimal("credit_amount", { precision: 8, scale: 2 }),
  createdAt: timestamp("created_at").defaultNow(),
});

/** Community mobility anchors — churches, campuses, Metro (C5). */
export const communityAnchors = pgTable("community_anchors", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  anchorType: varchar("anchor_type").notNull(),
  name: text("name").notNull(),
  location: jsonb("location").$type<{ lat: number; lng: number; address?: string }>(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

/** Phase D1 — Hourly demand forecast grid (extends heatmap). */
export const demandForecasts = pgTable("demand_forecasts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  gridLat: decimal("grid_lat", { precision: 10, scale: 6 }).notNull(),
  gridLng: decimal("grid_lng", { precision: 10, scale: 6 }).notNull(),
  hourOfDay: integer("hour_of_day").notNull(),
  dayOfWeek: integer("day_of_week").notNull(),
  forecastDate: timestamp("forecast_date").notNull(),
  predictedRides: integer("predicted_rides").default(0),
  confidence: decimal("confidence", { precision: 4, scale: 2 }).default("0.50"),
  lastUpdated: timestamp("last_updated").defaultNow(),
});

/** Phase D4 — Community bonus pool (no surge; subsidize undersupply). */
export const communityBonusPool = pgTable("community_bonus_pool", {
  id: varchar("id").primaryKey().default("default"),
  balance: decimal("balance", { precision: 12, scale: 2 }).default("0.00"),
  totalAllocated: decimal("total_allocated", { precision: 12, scale: 2 }).default("0.00"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const bonusAllocations = pgTable("bonus_allocations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  driverId: varchar("driver_id").notNull().references(() => users.id),
  rideId: varchar("ride_id").references(() => rides.id),
  amount: decimal("amount", { precision: 8, scale: 2 }).notNull(),
  reason: text("reason"),
  zoneLabel: varchar("zone_label"),
  createdAt: timestamp("created_at").defaultNow(),
});

/** Phase D6 — Recurring ride auto-rebook prompts. */
export const recurringRideSchedules = pgTable("recurring_ride_schedules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  templateId: varchar("template_id").references(() => rideTemplates.id),
  label: varchar("label").notNull(),
  pickup: jsonb("pickup").$type<{ lat: number; lng: number; address: string }>(),
  destination: jsonb("destination").$type<{ lat: number; lng: number; address: string }>().notNull(),
  recurrence: varchar("recurrence").notNull().default("weekly"),
  dayOfWeek: integer("day_of_week").notNull(),
  preferredHour: integer("preferred_hour").notNull().default(9),
  lastPromptAt: timestamp("last_prompt_at"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

/** Phase E3 — Admin approve-and-apply queue for agent actions. */
export const agentActionProposals = pgTable("agent_action_proposals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  agent: varchar("agent").notNull(),
  action: varchar("action").notNull(),
  status: varchar("status").default("pending").notNull(),
  userId: varchar("user_id").references(() => users.id),
  rideId: varchar("ride_id").references(() => rides.id),
  payload: jsonb("payload").$type<Record<string, unknown>>(),
  reasoning: text("reasoning"),
  proposedAt: timestamp("proposed_at").defaultNow(),
  reviewedBy: varchar("reviewed_by").references(() => users.id),
  reviewedAt: timestamp("reviewed_at"),
  reviewNote: text("review_note"),
});

/** Phase E2 — Driver compliance (W-9, doc expiry). */
export const complianceRecords = pgTable("compliance_records", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  driverId: varchar("driver_id").notNull().references(() => users.id),
  recordType: varchar("record_type").notNull(),
  status: varchar("status").default("missing").notNull(),
  expiresAt: timestamp("expires_at"),
  taxCompliancePath: varchar("tax_compliance_path"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_compliance_driver").on(table.driverId),
]);

/** Phase E4 — SMS booking session state. */
export const smsBookingSessions = pgTable("sms_booking_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  phone: varchar("phone").notNull().unique(),
  userId: varchar("user_id").references(() => users.id),
  state: varchar("state").default("idle").notNull(),
  context: jsonb("context").$type<Record<string, unknown>>(),
  activeRideId: varchar("active_ride_id").references(() => rides.id),
  updatedAt: timestamp("updated_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

/** Phase F1 — L4 readiness research (waypoint quality, disengagement). */
export const l4ReadinessEvents = pgTable("l4_readiness_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  rideId: varchar("ride_id").notNull().references(() => rides.id),
  driverId: varchar("driver_id").notNull().references(() => users.id),
  eventType: varchar("event_type").notNull(),
  waypointQuality: decimal("waypoint_quality", { precision: 4, scale: 3 }),
  speedMph: decimal("speed_mph", { precision: 6, scale: 2 }),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_l4_readiness_ride").on(table.rideId),
]);

/** Phase F2 — Share certificate provenance hash (off-chain SHA-256 v1). */
export const certificateProvenance = pgTable("certificate_provenance", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  certificateId: varchar("certificate_id").notNull().references(() => shareCertificates.id).unique(),
  contentHash: varchar("content_hash").notNull(),
  algorithm: varchar("algorithm").notNull().default("sha256"),
  payloadVersion: varchar("payload_version").default("v1"),
  onChainTxId: varchar("on_chain_tx_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

/** Phase F3 — Transit feed cache (WMATA, MARC, regional bus). */
export const transitFeedCache = pgTable("transit_feed_cache", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  agency: varchar("agency").notNull(),
  externalId: varchar("external_id"),
  alertType: varchar("alert_type").notNull(),
  title: varchar("title").notNull(),
  summary: text("summary"),
  severity: varchar("severity").default("info"),
  rawPayload: jsonb("raw_payload").$type<Record<string, unknown>>(),
  expiresAt: timestamp("expires_at"),
  fetchedAt: timestamp("fetched_at").defaultNow(),
}, (table) => [
  index("idx_transit_feed_agency").on(table.agency),
  index("idx_transit_feed_expires").on(table.expiresAt),
]);

/** Phase E6/E7 — Calm Ride mode + language preference. */
export const userRidePreferences = pgTable("user_ride_preferences", {
  userId: varchar("user_id").primaryKey().references(() => users.id),
  calmRideMode: varchar("calm_ride_mode").default("off").notNull(),
  preferredLanguage: varchar("preferred_language").default("en").notNull(),
  minimizeNotifications: boolean("minimize_notifications").default(false),
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

// Constrain issueType to a closed enum so the support auto-resolver can't be
// tricked by a client picking 'duplicate_charge' for unrelated complaints.
// Previously this was a free varchar — anything went, including invented
// types that would silently get high-credit treatment.
const ISSUE_TYPES_FOR_DISPUTE = [
  "fare_dispute",
  "short_wait",
  "wrong_route",
  "lost_item_minor",
  "promo_not_applied",
  "duplicate_charge",
  "driver_no_show",
  "safety",
  "other",
] as const;
export const insertDisputeSchema = createInsertSchema(disputes).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  issueType: z.enum(ISSUE_TYPES_FOR_DISPUTE),
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

export type PushSubscription = typeof pushSubscriptions.$inferSelect;

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

export const insertRideGroupSchema = createInsertSchema(rideGroups).omit({
  id: true,
  createdAt: true,
});
export type InsertRideGroup = z.infer<typeof insertRideGroupSchema>;
export type RideGroup = typeof rideGroups.$inferSelect;

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
export type AgentAuditLog = typeof agentAuditLog.$inferSelect;
export type PlatformInsight = typeof platformInsights.$inferSelect;
export type FaqEntry = typeof faqEntries.$inferSelect;
export type KnowledgeChunk = typeof knowledgeChunks.$inferSelect;
export type InAppNotification = typeof inAppNotifications.$inferSelect;
export type UserAutonomySettings = typeof userAutonomySettings.$inferSelect;
export type MobilityIntent = typeof mobilityIntents.$inferSelect;
export type RideSurfaceCache = typeof rideSurfaceCache.$inferSelect;
export type RideTemplate = typeof rideTemplates.$inferSelect;
export type GuardianLink = typeof guardianLinks.$inferSelect;
export type TrustEdge = typeof trustEdges.$inferSelect;
export type FavoriteDriver = typeof favoriteDrivers.$inferSelect;
export type RiderTrustPreferences = typeof riderTrustPreferences.$inferSelect;
export type CommunityReferral = typeof communityReferrals.$inferSelect;
export type CommunityAnchor = typeof communityAnchors.$inferSelect;
export type DemandForecast = typeof demandForecasts.$inferSelect;
export type CommunityBonusPool = typeof communityBonusPool.$inferSelect;
export type BonusAllocation = typeof bonusAllocations.$inferSelect;
export type RecurringRideSchedule = typeof recurringRideSchedules.$inferSelect;
export type AgentActionProposal = typeof agentActionProposals.$inferSelect;
export type ComplianceRecord = typeof complianceRecords.$inferSelect;
export type SmsBookingSession = typeof smsBookingSessions.$inferSelect;
export type UserRidePreferences = typeof userRidePreferences.$inferSelect;
export type DemandHeatmapEntry = typeof demandHeatmap.$inferSelect;
export type DriverScorecardEntry = typeof driverScorecard.$inferSelect;
export type SafetyAlert = typeof safetyAlerts.$inferSelect;
export type L4ReadinessEvent = typeof l4ReadinessEvents.$inferSelect;
export type CertificateProvenance = typeof certificateProvenance.$inferSelect;
export type TransitFeedEntry = typeof transitFeedCache.$inferSelect;

export type InsertEventTracking = z.infer<typeof insertEventTrackingSchema>;
export type InsertAiFeedback = z.infer<typeof insertAiFeedbackSchema>;
export type InsertPlatformInsight = z.infer<typeof insertPlatformInsightSchema>;
export type InsertFaqEntry = z.infer<typeof insertFaqEntrySchema>;
export type InsertSafetyAlert = z.infer<typeof insertSafetyAlertSchema>;

export type DriverRateCard = typeof driverRateCards.$inferSelect;
export type InsertDriverRateCard = z.infer<typeof insertDriverRateCardSchema>;

export const insertWalletTransactionSchema = createInsertSchema(walletTransactions).omit({
  id: true,
  createdAt: true,
});
export type InsertWalletTransaction = z.infer<typeof insertWalletTransactionSchema>;
export type WalletTransaction = typeof walletTransactions.$inferSelect;
