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
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  phone: varchar("phone"),
  isDriver: boolean("is_driver").default(false),
  isVerified: boolean("is_verified").default(false),
  rating: decimal("rating", { precision: 3, scale: 2 }).default("5.00"),
  totalRides: integer("total_rides").default(0),
  emergencyContact: varchar("emergency_contact"),
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

// Rides table
export const rides = pgTable("rides", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  riderId: varchar("rider_id").notNull().references(() => users.id),
  driverId: varchar("driver_id").references(() => users.id),
  pickupLocation: jsonb("pickup_location").$type<{lat: number, lng: number, address: string}>().notNull(),
  destinationLocation: jsonb("destination_location").$type<{lat: number, lng: number, address: string}>().notNull(),
  pickupInstructions: text("pickup_instructions"),
  status: rideStatusEnum("status").default("pending"),
  estimatedFare: decimal("estimated_fare", { precision: 8, scale: 2 }),
  actualFare: decimal("actual_fare", { precision: 8, scale: 2 }),
  distance: decimal("distance", { precision: 8, scale: 2 }),
  duration: integer("duration"), // in minutes
  tipAmount: decimal("tip_amount", { precision: 8, scale: 2 }).default("0.00"),
  riderRating: integer("rider_rating"),
  driverRating: integer("driver_rating"),
  riderReview: text("rider_review"),
  driverReview: text("driver_review"),
  scheduledAt: timestamp("scheduled_at"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Dispute reports
export const disputes = pgTable("disputes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  rideId: varchar("ride_id").notNull().references(() => rides.id),
  reporterId: varchar("reporter_id").notNull().references(() => users.id),
  issueType: varchar("issue_type").notNull(), // fare-dispute, route-issue, safety-concern, lost-item, other
  description: text("description").notNull(),
  status: varchar("status").default("pending"), // pending, investigating, resolved, closed
  resolution: text("resolution"),
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
  status: varchar("status").default("active"), // active, resolved
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Relations
export const usersRelations = relations(users, ({ one, many }) => ({
  driverProfile: one(driverProfiles, {
    fields: [users.id],
    references: [driverProfiles.userId],
  }),
  ridesAsRider: many(rides, { relationName: "rider" }),
  ridesAsDriver: many(rides, { relationName: "driver" }),
  disputes: many(disputes),
  emergencyIncidents: many(emergencyIncidents),
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

// Zod schemas for validation
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

// Types
export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;
export type DriverProfile = typeof driverProfiles.$inferSelect;
export type Vehicle = typeof vehicles.$inferSelect;
export type Ride = typeof rides.$inferSelect;
export type Dispute = typeof disputes.$inferSelect;
export type EmergencyIncident = typeof emergencyIncidents.$inferSelect;

export type InsertDriverProfile = z.infer<typeof insertDriverProfileSchema>;
export type InsertVehicle = z.infer<typeof insertVehicleSchema>;
export type InsertRide = z.infer<typeof insertRideSchema>;
export type InsertDispute = z.infer<typeof insertDisputeSchema>;
export type InsertEmergencyIncident = z.infer<typeof insertEmergencyIncidentSchema>;
